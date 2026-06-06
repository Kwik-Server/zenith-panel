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
        'Plan ID'                       => ['Type' => 'text', 'Size' => 10, 'Description' => 'Zenith Plan ID (number)'],
        'Default Template ID'           => ['Type' => 'text', 'Size' => 10, 'Description' => 'Fallback template if no OS selected'],
        'Node ID'                       => ['Type' => 'text', 'Size' => 10, 'Description' => 'Leave blank for auto-select'],
        'Ubuntu 22.04 Template ID'      => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Ubuntu 22.04'],
        'Debian 12 Template ID'         => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Debian 12'],
        'AlmaLinux 9 Template ID'       => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for AlmaLinux 9'],
        'AlmaLinux 8 Template ID'       => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for AlmaLinux 8'],
        'CentOS 9 Stream Template ID'   => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for CentOS 9 Stream'],
        'Rocky Linux 9 Template ID'     => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Rocky Linux 9'],
        'Ubuntu 24.04 Template ID'      => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Ubuntu 24.04'],
        'Debian 13 Template ID'         => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Debian 13'],
        'Windows Server 2019 Template ID' => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Windows Server 2019'],
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

        // Map selected OS to template ID
        $osTemplateMap = [
            'Ubuntu 22.04'         => (int)($params['configoption4']  ?? 0),
            'Debian 12'            => (int)($params['configoption5']  ?? 0),
            'AlmaLinux 9'          => (int)($params['configoption6']  ?? 0),
            'AlmaLinux 8'          => (int)($params['configoption7']  ?? 0),
            'CentOS 9 Stream'      => (int)($params['configoption8']  ?? 0),
            'Rocky Linux 9'        => (int)($params['configoption9']  ?? 0),
            'Ubuntu 24.04'         => (int)($params['configoption10'] ?? 0),
            'Debian 13'            => (int)($params['configoption11'] ?? 0),
            'Windows Server 2019'  => (int)($params['configoption12'] ?? 0),
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
        $api    = _zenith_api($params);
        $data   = $api->getStatus($uuid);
        $ip     = $data['ip_address'] ?? '';
        $status = ucfirst($data['status'] ?? 'unknown');

        // Sync assigned IP into WHMCS dedicated IP field
        if ($ip && function_exists('localAPI')) {
            localAPI('UpdateClientProduct', [
                'serviceid'   => $params['serviceid'],
                'dedicatedip' => $ip,
            ]);
        }

        $fields = [
            'VPS Status'  => $status,
            'Assigned IP' => $ip ?: 'Not yet assigned (provisioning in progress)',
            'UUID'        => $uuid,
        ];

        // rDNS / PTR fields — one editable input per assigned IP
        try {
            $rdnsList = $api->getRdns($uuid);
            foreach ($rdnsList as $entry) {
                $ipAddr    = htmlspecialchars($entry['ip'] ?? '');
                $ptr       = htmlspecialchars($entry['ptr'] ?? '');
                $fieldName = 'rdns_' . str_replace(['.', ':'], '_', $ipAddr);
                $errNote   = isset($entry['error'])
                    ? ' &nbsp;<span style="color:#c0392b;font-size:11px">(' . htmlspecialchars($entry['error']) . ')</span>'
                    : '';
                $fields["PTR for {$ipAddr}"] =
                    '<input type="text" name="' . $fieldName . '" value="' . $ptr . '" '
                    . 'style="width:300px;padding:3px 6px;font-family:monospace" '
                    . 'placeholder="e.g. mail.example.com" />' . $errNote;
            }
            if (empty($rdnsList)) {
                $fields['rDNS'] = 'No IPs assigned to this VPS.';
            }
        } catch (Exception $e) {
            $fields['rDNS Error'] = htmlspecialchars($e->getMessage());
        }

        return $fields;
    } catch (Exception $e) {
        return ['Zenith Error' => $e->getMessage()];
    }
}

function zenith_AdminServicesTabFieldsSave(array $params): string {
    $uuid = _zenith_getuuid($params);
    if (!$uuid) return '';

    $api = _zenith_api($params);

    try {
        $rdnsList = $api->getRdns($uuid);
    } catch (Exception $e) {
        return 'Could not fetch rDNS records: ' . $e->getMessage();
    }

    $errors = [];
    foreach ($rdnsList as $entry) {
        $ipAddr    = $entry['ip'] ?? '';
        $fieldName = 'rdns_' . str_replace(['.', ':'], '_', $ipAddr);
        if (!array_key_exists($fieldName, $params['modulefields'] ?? [])) continue;

        $newPtr = trim($params['modulefields'][$fieldName]);
        $oldPtr = $entry['ptr'] ?? '';
        if ($newPtr === $oldPtr) continue;

        try {
            $api->updateRdns($uuid, $ipAddr, $newPtr);
            logActivity(
                "Zenith: Admin updated PTR for {$ipAddr} on VPS {$uuid} → " . ($newPtr ?: '(cleared)'),
                $params['userid']
            );
        } catch (Exception $e) {
            $errors[] = "Failed {$ipAddr}: " . $e->getMessage();
        }
    }

    return implode('; ', $errors);
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


function _zenith_rdns_fetch(array $params, string $uuid): array {
    try {
        return _zenith_api($params)->getRdns($uuid);
    } catch (Exception $e) {
        return [];
    }
}

function _zenith_clientarea_render(array $params, string $rdnsMessage = '', string $rdnsError = ''): array {
    $scheme   = !empty($params['serversecure']) ? 'https' : 'http';
    $panelUrl = "{$scheme}://{$params['serverhostname']}";
    $uuid     = _zenith_getuuid($params);

    $status     = 'Unknown';
    $loginUrl   = $panelUrl . '/login';
    $serverInfo = null;
    $ipAddress  = $params['model']->dedicatedip ?? '';
    $osName     = $params['customfields']['Operating System'] ?? 'Linux VPS';
    $error      = '';
    $rdnsList   = [];

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

        $rdnsList = _zenith_rdns_fetch($params, $uuid);
    }

    try {
        $result = _zenith_api($params)->generateLoginToken($params['clientsdetails']['email']);
        $token  = $result['token'] ?? '';
        if ($token) $loginUrl = $panelUrl . '/autologin?token=' . urlencode($token);
    } catch (Exception $e) {}

    $statusMap = [
        'running'     => ['bg' => 'rgba(34,197,94,0.15)',  'color' => '#4ade80', 'dot' => '&#9679;'],
        'stopped'     => ['bg' => 'rgba(148,163,184,0.15)','color' => '#94a3b8', 'dot' => '&#9675;'],
        'suspended'   => ['bg' => 'rgba(251,191,36,0.15)', 'color' => '#fbbf24', 'dot' => '&#9651;'],
        'reinstalling'=> ['bg' => 'rgba(99,102,241,0.15)', 'color' => '#818cf8', 'dot' => '&#9672;'],
    ];
    $statusLower = strtolower($status);
    $s = $statusMap[$statusLower] ?? ['bg' => 'rgba(100,116,139,0.15)', 'color' => '#64748b', 'dot' => '&#8212;'];

    // Get WHMCS session token explicitly so template doesn't rely on global Smarty var
    $whmcsToken = '';
    try {
        $whmcsToken = \WHMCS\Session::get('token') ?? '';
    } catch (\Exception $e) {
        $whmcsToken = $_SESSION['token'] ?? '';
    }

    return [
        'templatefile' => 'clientarea',
        'vars' => [
            'hostname'     => $params['model']->domain ?: $ipAddress,
            'status'       => $status,
            'status_bg'    => $s['bg'],
            'status_color' => $s['color'],
            'status_dot'   => $s['dot'],
            'login_url'    => $loginUrl,
            'ip_address'   => $ipAddress ?: 'Provisioning...',
            'os_name'      => $osName,
            'cpu'          => $serverInfo['cpu'] ?? '',
            'ram'          => $serverInfo['ram'] ?? '',
            'disk'         => $serverInfo['disk'] ?? '',
            'rdns_list'    => $rdnsList,
            'rdns_message' => $rdnsMessage,
            'rdns_error'   => $rdnsError,
            'serviceid'    => $params['serviceid'],
            'whmcs_token'  => $whmcsToken,
        ],
    ];
}

function zenith_ClientArea(array $params): array {
    $rdnsMessage = '';
    $rdnsError   = '';

    // Handle rDNS form submission directly — avoids WHMCS module routing entirely
    if (
        $_SERVER['REQUEST_METHOD'] === 'POST' &&
        ($_POST['zenith_action'] ?? '') === 'update_rdns'
    ) {
        $uuid = _zenith_getuuid($params);
        $ip   = trim($_POST['rdns_ip']  ?? '');
        $ptr  = trim($_POST['rdns_ptr'] ?? '');

        if (!$uuid) {
            $rdnsError = 'VPS not provisioned yet.';
        } elseif (!$ip) {
            $rdnsError = 'IP address missing from request.';
        } else {
            try {
                _zenith_api($params)->updateRdns($uuid, $ip, $ptr);
                $rdnsMessage = "PTR for {$ip} updated" . ($ptr ? " → {$ptr}" : ' (cleared)');
                logActivity(
                    "Zenith: Client updated PTR for {$ip} on VPS {$uuid} → " . ($ptr ?: '(cleared)'),
                    $params['userid']
                );
            } catch (Exception $e) {
                $rdnsError = $e->getMessage();
            }
        }
    }

    return _zenith_clientarea_render($params, $rdnsMessage, $rdnsError);
}
