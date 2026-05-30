<?php
/**
 * Zenith WHMCS Server Module
 * Supports: KVM and LXC via Proxmox VE
 */

if (!defined('WHMCS')) die('Access denied');

use WHMCS\Database\Capsule;

require_once __DIR__ . '/lib/ZenithAPI.php';

function zenith_MetaData(): array {
    return ['DisplayName' => 'Zenith', 'APIVersion' => '1.1', 'RequiresServer' => true];
}

function zenith_ConfigOptions(): array {
    return [
        'Plan ID'             => ['Type' => 'text', 'Size' => 10, 'Description' => 'Zenith Plan ID (number)'],
        'Default Template ID' => ['Type' => 'text', 'Size' => 10, 'Description' => 'Fallback template if no OS selected'],
        'Node ID'             => ['Type' => 'text', 'Size' => 10, 'Description' => 'Leave blank for auto-select'],
        'Ubuntu Template ID'  => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Ubuntu'],
        'Debian Template ID'  => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Debian'],
        'AlmaLinux 9 Template ID' => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for AlmaLinux 9'],
        'AlmaLinux 8 Template ID' => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for AlmaLinux 8'],
    ];
}

function _zenith_api(array $params): ZenithAPI {
    $host    = $params['serverhostname'];
    $apiKey  = $params['serverpassword'];
    $secure  = !empty($params['serversecure']);
    return new ZenithAPI($host, $apiKey, $secure);
}

function _zenith_getuuid(array $params): string {
    // Try custom field first
    if (!empty($params['customfields']['vps_uuid'])) {
        return $params['customfields']['vps_uuid'];
    }
    // Try model notes
    if (preg_match('/VPS_UUID:([a-f0-9\-]{36})/i', $params['model']->notes ?? '', $m)) {
        return $m[1];
    }
    // Direct DB lookup as last resort
    try {
        $notes = Capsule::table('tblhosting')->where('id', $params['serviceid'])->value('notes');
        if ($notes && preg_match('/VPS_UUID:([a-f0-9\-]{36})/i', $notes, $m)) {
            return $m[1];
        }
    } catch (\Exception $e) {}
    return '';
}

function zenith_CreateAccount(array $params): string {
    try {
        $api = _zenith_api($params);
        $hostname = $params['domain']
            ?: strtolower(preg_replace('/[^a-z0-9\-]/', '', $params['username'])) . '.vps.local';
        $password = $params['password'] ?: bin2hex(random_bytes(8));

        // Map selected OS to template ID (configoption4-7 per OS)
        $osTemplateMap = [
            'Ubuntu 22.04' => (int)($params['configoption4'] ?? 0),
            'Debian 12'    => (int)($params['configoption5'] ?? 0),
            'AlmaLinux 9'  => (int)($params['configoption6'] ?? 0),
            'AlmaLinux 8'  => (int)($params['configoption7'] ?? 0),
        ];
        $selectedOs = $params['customfields']['Operating System'] ?? '';
        $templateId = ($selectedOs && isset($osTemplateMap[$selectedOs]) && $osTemplateMap[$selectedOs])
            ? $osTemplateMap[$selectedOs]
            : (int)($params['configoption2'] ?? 0);

        $request = [
            'plan_id'         => (int)($params['configoption1'] ?? 0),
            'template_id'     => $templateId,
            'node_id'         => (int)($params['configoption3'] ?? 0) ?: null,
            'hostname'        => $hostname,
            'root_password'   => '***',
            'user_email'      => $params['clientsdetails']['email'],
            'whmcs_service_id'=> (string)$params['serviceid'],
        ];

        $result = $api->provision(array_merge($request, ['root_password' => $password]));
        $uuid   = $result['uuid'] ?? '';

        logModuleCall('zenith', 'CreateAccount', $request, $result);
        logActivity("Zenith: VPS created — hostname {$hostname}, UUID {$uuid}, OS: " . ($selectedOs ?: 'default'), $params['userid']);

        // Save UUID to custom field
        Capsule::table('tblcustomfieldsvalues')
            ->where('fieldid', function ($q) use ($params) {
                $q->select('id')->from('tblcustomfields')
                  ->where('relid', $params['pid'])
                  ->where('fieldname', 'vps_uuid')
                  ->limit(1);
            })
            ->where('relid', $params['serviceid'])
            ->updateOrInsert(
                ['relid' => $params['serviceid']],
                ['value' => $uuid]
            );

        // Also save to notes as fallback
        Capsule::table('tblhosting')->where('id', $params['serviceid'])
            ->update(['notes' => "VPS_UUID:{$uuid}\nHostname: " . ($result['hostname'] ?? '')]);

        return 'success';
    } catch (Exception $e) {
        logModuleCall('zenith', 'CreateAccount', ['hostname' => $params['domain'] ?? ''], $e->getMessage());
        logActivity("Zenith: VPS creation FAILED for client #{$params['userid']} — " . $e->getMessage(), $params['userid']);
        return 'Error: ' . $e->getMessage();
    }
}

function zenith_SuspendAccount(array $params): string {
    try {
        $uuid = _zenith_getuuid($params);
        if (!$uuid) return 'Error: VPS UUID not found. Was the VPS created?';
        _zenith_api($params)->suspend($uuid);
        logModuleCall('zenith', 'SuspendAccount', ['uuid' => $uuid], 'success');
        logActivity("Zenith: VPS suspended — UUID {$uuid}", $params['userid']);
        return 'success';
    } catch (Exception $e) {
        logModuleCall('zenith', 'SuspendAccount', ['uuid' => _zenith_getuuid($params)], $e->getMessage());
        logActivity("Zenith: VPS suspend FAILED — " . $e->getMessage(), $params['userid']);
        return 'Error: ' . $e->getMessage();
    }
}

function zenith_UnsuspendAccount(array $params): string {
    try {
        $uuid = _zenith_getuuid($params);
        if (!$uuid) return 'Error: VPS UUID not found.';
        _zenith_api($params)->unsuspend($uuid);
        logModuleCall('zenith', 'UnsuspendAccount', ['uuid' => $uuid], 'success');
        logActivity("Zenith: VPS unsuspended — UUID {$uuid}", $params['userid']);
        return 'success';
    } catch (Exception $e) {
        logModuleCall('zenith', 'UnsuspendAccount', ['uuid' => _zenith_getuuid($params)], $e->getMessage());
        logActivity("Zenith: VPS unsuspend FAILED — " . $e->getMessage(), $params['userid']);
        return 'Error: ' . $e->getMessage();
    }
}

function zenith_TerminateAccount(array $params): string {
    try {
        $uuid = _zenith_getuuid($params);
        if (!$uuid) return 'success'; // already gone
        _zenith_api($params)->terminate($uuid);
        logModuleCall('zenith', 'TerminateAccount', ['uuid' => $uuid], 'success');
        logActivity("Zenith: VPS terminated — UUID {$uuid}", $params['userid']);
        return 'success';
    } catch (Exception $e) {
        logModuleCall('zenith', 'TerminateAccount', ['uuid' => _zenith_getuuid($params)], $e->getMessage());
        logActivity("Zenith: VPS termination FAILED — " . $e->getMessage(), $params['userid']);
        return 'Error: ' . $e->getMessage();
    }
}

function zenith_AdminServicesTabFields(array $params): array {
    $uuid = _zenith_getuuid($params);
    if (!$uuid) {
        return ['Zenith Status' => 'VPS not yet provisioned'];
    }
    try {
        $data   = _zenith_api($params)->getStatus($uuid);
        $ip     = $data['ip_address'] ?? '';
        $status = ucfirst($data['status'] ?? 'unknown');

        // Sync assigned IP into WHMCS dedicated IP field
        if ($ip && function_exists('localAPI')) {
            localAPI('UpdateClientProduct', [
                'serviceid'   => $params['serviceid'],
                'dedicatedip' => $ip,
            ]);
        }

        return [
            'VPS Status'  => $status,
            'Assigned IP' => $ip ?: 'Not yet assigned (provisioning in progress)',
            'UUID'        => $uuid,
        ];
    } catch (Exception $e) {
        return ['Zenith Error' => $e->getMessage()];
    }
}

function zenith_TestConnection(array $params): array {
    try {
        $ok = _zenith_api($params)->testConnection();
        return $ok
            ? ['success' => true, 'error' => '']
            : ['success' => false, 'error' => 'Connection failed'];
    } catch (Exception $e) {
        return ['success' => false, 'error' => $e->getMessage()];
    }
}

function zenith_AdminLink(array $params): string {
    $scheme = !empty($params['serversecure']) ? 'https' : 'http';
    $host   = $params['serverhostname'];
    $uuid   = _zenith_getuuid($params);
    if (!$uuid) return '<p>VPS not yet provisioned.</p>';
    return "<a href=\"{$scheme}://{$host}/admin\" target=\"_blank\" class=\"btn btn-default\">Open Zenith Admin</a>";
}

function zenith_ClientArea(array $params): array {
    $scheme   = !empty($params['serversecure']) ? 'https' : 'http';
    $panelUrl = "{$scheme}://{$params['serverhostname']}";
    $uuid     = _zenith_getuuid($params);

    $status     = 'Unknown';
    $loginUrl   = $panelUrl . '/login';
    $serverInfo = null;
    $ipAddress  = $params['model']->dedicatedip ?? '';
    $osName     = $params['customfields']['Operating System'] ?? 'Linux VPS';
    $error      = '';

    if ($uuid) {
        try {
            $data   = _zenith_api($params)->getStatus($uuid);
            $status = ucfirst($data['status'] ?? 'unknown');
            if (!empty($data['cpu'])) {
                $serverInfo = [
                    'cpu'  => $data['cpu'] . ' vCPU',
                    'ram'  => ($data['ram'] >= 1024 ? round($data['ram']/1024) . 'G' : $data['ram'] . 'M'),
                    'disk' => $data['disk'] . 'G',
                ];
            }
            if (!empty($data['ip_address'])) $ipAddress = $data['ip_address'];
        } catch (Exception $e) {
            $error = 'Could not fetch VPS status.';
        }
    }

    // Generate magic link for auto-login
    try {
        $result = _zenith_api($params)->generateLoginToken($params['clientsdetails']['email']);
        $token  = $result['token'] ?? '';
        if ($token) $loginUrl = $panelUrl . '/autologin?token=' . urlencode($token);
    } catch (Exception $e) {}

    // Status styling
    $statusMap = [
        'running'     => ['bg' => 'rgba(34,197,94,0.15)',  'color' => '#4ade80', 'dot' => '&#9679;'],
        'stopped'     => ['bg' => 'rgba(148,163,184,0.15)','color' => '#94a3b8', 'dot' => '&#9675;'],
        'suspended'   => ['bg' => 'rgba(251,191,36,0.15)', 'color' => '#fbbf24', 'dot' => '&#9651;'],
        'reinstalling'=> ['bg' => 'rgba(99,102,241,0.15)', 'color' => '#818cf8', 'dot' => '&#9672;'],
    ];
    $statusLower = strtolower($status);
    $s = $statusMap[$statusLower] ?? ['bg' => 'rgba(100,116,139,0.15)', 'color' => '#64748b', 'dot' => '&#8212;'];

    return [
        'templatefile' => 'clientarea',
        'vars' => [
            'hostname'    => $params['model']->domain ?: $ipAddress,
            'status'      => $status,
            'status_bg'   => $s['bg'],
            'status_color'=> $s['color'],
            'status_dot'  => $s['dot'],
            'login_url'   => $loginUrl,
            'ip_address'  => $ipAddress ?: 'Provisioning...',
            'os_name'     => $osName,
            'cpu'         => $serverInfo['cpu'] ?? '',
            'ram'         => $serverInfo['ram'] ?? '',
            'disk'        => $serverInfo['disk'] ?? '',
        ],
    ];
}
