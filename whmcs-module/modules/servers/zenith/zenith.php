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
        return ['Zenith Status' => 'VPS not yet provisioned — run Create first.'];
    }

    try {
        $api    = _zenith_api($params);
        $data   = $api->getStatus($uuid);
        $ip     = $data['ip_address'] ?? '';
        $status = ucfirst($data['status'] ?? 'unknown');
        $statusLower = strtolower($data['status'] ?? '');

        if ($ip && function_exists('localAPI')) {
            localAPI('UpdateClientProduct', ['serviceid' => $params['serviceid'], 'dedicatedip' => $ip]);
        }

        $statusLabel = [
            'running'     => '<span class="label label-success">● Running</span>',
            'stopped'     => '<span class="label label-default">○ Stopped</span>',
            'suspended'   => '<span class="label label-warning">⏸ Suspended</span>',
            'creating'    => '<span class="label label-info">⟳ Creating</span>',
            'error'       => '<span class="label label-danger">✕ Error</span>',
        ][$statusLower] ?? "<span class=\"label label-default\">{$status}</span>";

        $isRunning = $statusLower === 'running';
        $isStopped = in_array($statusLower, ['stopped', 'suspended', 'error']);

        // Live stats
        $stats     = $api->getStats($uuid);
        $cpuPct    = (int)($stats['cpu_pct']   ?? 0);
        $ramUsed   = (int)($stats['ram_used']  ?? 0);
        $ramTotal  = (int)($stats['ram_total'] ?? 0);
        $diskTotal = (int)($stats['disk_total']?? 0);
        $ramPct    = $ramTotal > 0 ? round($ramUsed / $ramTotal * 100) : 0;
        $ramUsedGb = $ramUsed >= 1024 ? round($ramUsed / 1024, 1) . ' GB' : $ramUsed . ' MB';
        $ramTotalGb= $ramTotal >= 1024 ? round($ramTotal / 1024, 1) . ' GB' : $ramTotal . ' MB';

        $cpuColor  = $cpuPct > 85 ? 'danger' : ($cpuPct > 60 ? 'warning' : 'success');
        $ramColor  = $ramPct > 85 ? 'danger' : ($ramPct > 60 ? 'warning' : 'info');

        // ── Power Controls ──────────────────────────────────────────────────
        $powerHtml = '
<input type="hidden" id="zenith_power_action" name="zenith_power_action" value="" />
<script>
function zenithPower(action, msg) {
    if (msg && !window.confirm(msg)) return;
    document.getElementById("zenith_power_action").value = action;
    var el = document.getElementById("zenith_power_action");
    var form = el.form || (el.closest ? el.closest("form") : null) || document.forms[0];
    if (form) form.submit();
}
</script>
' . $statusLabel . '
<span style="margin-left:15px;">
    <button type="button" class="btn btn-success btn-xs" onclick="zenithPower(\'start\')"
        ' . ($isRunning ? 'disabled' : '') . '>&#9654; Start</button>
    <button type="button" class="btn btn-default btn-xs" onclick="zenithPower(\'restart\',\'Reboot this VPS?\')"
        ' . (!$isRunning ? 'disabled' : '') . '>&#8635; Reboot</button>
    <button type="button" class="btn btn-danger btn-xs" onclick="zenithPower(\'stop\',\'Stop this VPS?\')"
        ' . (!$isRunning ? 'disabled' : '') . '>&#9646;&#9646; Stop</button>
</span>';

        // ── Info Table ───────────────────────────────────────────────────────
        $infoHtml = '
<table class="table table-condensed" style="margin:0;width:auto;">
    <tr><td style="color:#888;width:80px;">VMID</td>       <td><code>' . htmlspecialchars($data['uuid'] ?? $uuid) . '</code></td></tr>
    <tr><td style="color:#888;">IP</td>         <td><code>' . htmlspecialchars($ip ?: '—') . '</code></td></tr>
    <tr><td style="color:#888;">UUID</td>       <td><small style="font-family:monospace">' . htmlspecialchars($uuid) . '</small></td></tr>
    <tr><td style="color:#888;">Type</td>       <td>' . strtoupper(htmlspecialchars($data['type'] ?? '')) . '</td></tr>
    <tr><td style="color:#888;">CPU</td>        <td>' . htmlspecialchars($data['cpu'] ?? '—') . ' vCPU</td></tr>
    <tr><td style="color:#888;">RAM</td>        <td>' . $ramTotalGb . '</td></tr>
    <tr><td style="color:#888;">Disk</td>       <td>' . htmlspecialchars($diskTotal) . ' GB</td></tr>
</table>';

        // ── Resource Bars ────────────────────────────────────────────────────
        $statsHtml = $isRunning ? '
<div style="max-width:320px;">
    <div style="margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
            <span>CPU</span><span>' . $cpuPct . '%</span>
        </div>
        <div class="progress progress-xs" style="height:10px;margin:0;">
            <div class="progress-bar progress-bar-' . $cpuColor . '" style="width:' . $cpuPct . '%"></div>
        </div>
    </div>
    <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px;">
            <span>RAM</span><span>' . $ramUsedGb . ' / ' . $ramTotalGb . '</span>
        </div>
        <div class="progress progress-xs" style="height:10px;margin:0;">
            <div class="progress-bar progress-bar-' . $ramColor . '" style="width:' . $ramPct . '%"></div>
        </div>
    </div>
</div>' : '<span style="color:#aaa;font-size:12px;">VPS is ' . $status . ' — stats unavailable</span>';

        // ── PTR Records ──────────────────────────────────────────────────────
        $rdnsHtml = '';
        try {
            $rdnsList = $api->getRdns($uuid);
            if (!empty($rdnsList)) {
                foreach ($rdnsList as $entry) {
                    $ipAddr    = htmlspecialchars($entry['ip'] ?? '');
                    $ptr       = htmlspecialchars($entry['ptr'] ?? '');
                    $fieldName = 'rdns_' . str_replace(['.', ':'], '_', $ipAddr);
                    $errNote   = isset($entry['error'])
                        ? ' <span style="color:#c0392b;font-size:11px">(' . htmlspecialchars($entry['error']) . ')</span>' : '';
                    $rdnsHtml .= '
<div style="margin-bottom:6px;">
    <label style="font-weight:normal;font-size:12px;color:#666;margin-bottom:2px;display:block;">' . $ipAddr . '</label>
    <input type="text" name="' . $fieldName . '" value="' . $ptr . '"
        style="width:280px;padding:3px 6px;font-family:monospace;border:1px solid #ccc;border-radius:3px;display:inline-block;"
        placeholder="e.g. mail.example.com" />' . $errNote . '
</div>';
                }
                $rdnsHtml .= '<button type="submit" class="btn btn-primary btn-sm" style="margin-top:4px;" onclick="document.getElementById(\'zenith_power_action\').value=\'\';">Save PTR Records</button>';
            } else {
                $rdnsHtml = '<span style="color:#aaa;font-size:12px;">No IPs assigned.</span>';
            }
        } catch (Exception $e) {
            $rdnsHtml = '<span style="color:#c0392b;">' . htmlspecialchars($e->getMessage()) . '</span>';
        }

        return [
            'Power Controls' => $powerHtml,
            'VPS Details'    => $infoHtml,
            'Resource Usage' => $statsHtml,
            'rDNS / PTR'     => $rdnsHtml,
        ];

    } catch (Exception $e) {
        return ['Zenith Error' => htmlspecialchars($e->getMessage())];
    }
}

function zenith_AdminServicesTabFieldsSave(array $params): string {
    $uuid = _zenith_getuuid($params);
    if (!$uuid) return '';

    $api         = _zenith_api($params);
    $fields      = $params['modulefields'] ?? [];
    $powerAction = trim($fields['zenith_power_action'] ?? '');

    // Handle power control actions
    if ($powerAction) {
        try {
            switch ($powerAction) {
                case 'start':
                    $api->start($uuid);
                    logActivity("Zenith: Admin started VPS {$uuid}", $params['userid']);
                    break;
                case 'stop':
                    $api->stop($uuid);
                    logActivity("Zenith: Admin stopped VPS {$uuid}", $params['userid']);
                    break;
                case 'restart':
                    $api->restart($uuid);
                    logActivity("Zenith: Admin rebooted VPS {$uuid}", $params['userid']);
                    break;
            }
            return '';
        } catch (Exception $e) {
            return 'Power action failed: ' . $e->getMessage();
        }
    }

    // Handle PTR / rDNS save
    try {
        $rdnsList = $api->getRdns($uuid);
    } catch (Exception $e) {
        return 'Could not fetch rDNS records: ' . $e->getMessage();
    }

    $errors = [];
    foreach ($rdnsList as $entry) {
        $ipAddr    = $entry['ip'] ?? '';
        $fieldName = 'rdns_' . str_replace(['.', ':'], '_', $ipAddr);
        if (!array_key_exists($fieldName, $fields)) continue;
        $newPtr = trim($fields[$fieldName]);
        $oldPtr = $entry['ptr'] ?? '';
        if ($newPtr === $oldPtr) continue;
        try {
            $api->updateRdns($uuid, $ipAddr, $newPtr);
            logActivity("Zenith: Admin updated PTR for {$ipAddr} on VPS {$uuid} → " . ($newPtr ?: '(cleared)'), $params['userid']);
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

function _zenith_clientarea_render(array $params, string $actionMessage = '', string $actionError = ''): array {
    $scheme   = !empty($params['serversecure']) ? 'https' : 'http';
    $panelUrl = "{$scheme}://{$params['serverhostname']}";
    $uuid     = _zenith_getuuid($params);

    $status     = 'Unknown';
    $loginUrl   = $panelUrl . '/login';
    $serverInfo = null;
    $ipAddress  = $params['model']->dedicatedip ?? '';
    $osName     = $params['customfields']['Operating System'] ?? 'Linux VPS';
    $rdnsList   = [];
    $templatesList = [];
    $vpsType    = 'kvm';

    if ($uuid) {
        try {
            $api    = _zenith_api($params);
            $data   = $api->getStatus($uuid);
            $status = ucfirst($data['status'] ?? 'unknown');
            $vpsType = $data['type'] ?? 'kvm';
            if (!empty($data['cpu'])) {
                $serverInfo = [
                    'cpu'  => $data['cpu'] . ' vCPU',
                    'ram'  => ($data['ram'] >= 1024 ? round($data['ram']/1024) . 'G' : $data['ram'] . 'M'),
                    'disk' => $data['disk'] . 'G',
                ];
            }
            if (!empty($data['ip_address'])) $ipAddress = $data['ip_address'];
        } catch (Exception $e) {}

        $rdnsList = _zenith_rdns_fetch($params, $uuid);

        try {
            $templatesList = _zenith_api($params)->getTemplates($vpsType);
        } catch (Exception $e) {}
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
            'rdns_list'      => $rdnsList,
            'templates_list' => $templatesList,
            'action_message' => $actionMessage,
            'action_error'   => $actionError,
            'serviceid'      => $params['serviceid'],
            'whmcs_token'    => $whmcsToken,
            'status_raw'     => $statusLower,
        ],
    ];
}

function zenith_ClientArea(array $params): array {
    $actionMessage = '';
    $actionError   = '';

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $zenithAction = $_POST['zenith_action'] ?? '';
        $uuid         = _zenith_getuuid($params);
        $api          = $uuid ? _zenith_api($params) : null;

        if (!$uuid && $zenithAction) {
            $actionError = 'VPS not provisioned yet.';
        } elseif ($zenithAction === 'update_rdns') {
            $ip  = trim($_POST['rdns_ip']  ?? '');
            $ptr = trim($_POST['rdns_ptr'] ?? '');
            if (!$ip) {
                $actionError = 'IP address missing from request.';
            } else {
                try {
                    $api->updateRdns($uuid, $ip, $ptr);
                    $actionMessage = "PTR for {$ip} updated" . ($ptr ? " → {$ptr}" : ' (cleared)');
                    logActivity("Zenith: Client updated PTR for {$ip} on VPS {$uuid} → " . ($ptr ?: '(cleared)'), $params['userid']);
                } catch (Exception $e) { $actionError = $e->getMessage(); }
            }

        } elseif ($zenithAction === 'start') {
            try {
                $api->start($uuid);
                $actionMessage = 'VPS start queued.';
                logActivity("Zenith: Client started VPS {$uuid}", $params['userid']);
            } catch (Exception $e) { $actionError = $e->getMessage(); }

        } elseif ($zenithAction === 'stop') {
            try {
                $api->stop($uuid);
                $actionMessage = 'VPS stop queued.';
                logActivity("Zenith: Client stopped VPS {$uuid}", $params['userid']);
            } catch (Exception $e) { $actionError = $e->getMessage(); }

        } elseif ($zenithAction === 'restart') {
            try {
                $api->restart($uuid);
                $actionMessage = 'VPS restart queued.';
                logActivity("Zenith: Client restarted VPS {$uuid}", $params['userid']);
            } catch (Exception $e) { $actionError = $e->getMessage(); }

        } elseif ($zenithAction === 'reinstall') {
            $password   = trim($_POST['reinstall_password']   ?? '');
            $templateId = (int)($_POST['reinstall_template_id'] ?? 0);
            if (strlen($password) < 8) {
                $actionError = 'Password must be at least 8 characters.';
            } else {
                try {
                    $api->reinstall($uuid, $password, $templateId);
                    $actionMessage = 'Reinstall queued. Your VPS will be ready in a few minutes.';
                    logActivity("Zenith: Client reinstalled VPS {$uuid}" . ($templateId ? " (template {$templateId})" : ''), $params['userid']);
                } catch (Exception $e) { $actionError = $e->getMessage(); }
            }
        }
    }

    return _zenith_clientarea_render($params, $actionMessage, $actionError);
}
