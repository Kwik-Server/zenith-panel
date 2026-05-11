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
    // Fall back to service notes
    if (preg_match('/VPS_UUID:([a-f0-9\-]{36})/i', $params['model']->notes ?? '', $m)) {
        return $m[1];
    }
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

        $result = $api->provision([
            'plan_id'         => (int)($params['configoption1'] ?? 0),
            'template_id'     => $templateId,
            'node_id'         => (int)($params['configoption3'] ?? 0) ?: null,
            'hostname'        => $hostname,
            'root_password'   => $password,
            'user_email'      => $params['clientsdetails']['email'],
            'whmcs_service_id'=> (string)$params['serviceid'],
        ]);

        $uuid = $result['uuid'] ?? '';

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
        return 'Error: ' . $e->getMessage();
    }
}

function zenith_SuspendAccount(array $params): string {
    try {
        $uuid = _zenith_getuuid($params);
        if (!$uuid) return 'Error: VPS UUID not found. Was the VPS created?';
        _zenith_api($params)->suspend($uuid);
        return 'success';
    } catch (Exception $e) { return 'Error: ' . $e->getMessage(); }
}

function zenith_UnsuspendAccount(array $params): string {
    try {
        $uuid = _zenith_getuuid($params);
        if (!$uuid) return 'Error: VPS UUID not found.';
        _zenith_api($params)->unsuspend($uuid);
        return 'success';
    } catch (Exception $e) { return 'Error: ' . $e->getMessage(); }
}

function zenith_TerminateAccount(array $params): string {
    try {
        $uuid = _zenith_getuuid($params);
        if (!$uuid) return 'success'; // already gone
        _zenith_api($params)->terminate($uuid);
        return 'success';
    } catch (Exception $e) { return 'Error: ' . $e->getMessage(); }
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
    $scheme  = !empty($params['serversecure']) ? 'https' : 'http';
    $panelUrl = "{$scheme}://{$params['serverhostname']}";
    $uuid    = _zenith_getuuid($params);

    $status = 'Unknown';
    if ($uuid) {
        try {
            $data   = _zenith_api($params)->getStatus($uuid);
            $status = ucfirst($data['status'] ?? 'unknown');
        } catch (Exception $e) {}
    }

    return [
        'templatefile' => 'clientarea',
        'vars' => [
            'panel_url' => $panelUrl,
            'uuid'      => $uuid,
            'status'    => $status,
        ],
    ];
}
