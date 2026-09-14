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
        'CentOS 8 Template ID'          => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for CentOS 8'],
        'Ubuntu 25.04 Template ID'      => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Ubuntu 25.04'],
        'Ubuntu 26.04 Template ID'      => ['Type' => 'text', 'Size' => 10, 'Description' => 'Template ID for Ubuntu 26.04'],
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

    // Finally, ask Zenith which VPS is linked to this service. A VPS created directly
    // in the panel has no UUID anywhere in WHMCS, so without this every billing action
    // on it fails with "VPS UUID not found" — linking such a VPS then only requires
    // setting whmcs_service_id in Zenith, with nothing written into WHMCS.
    if (!empty($params['serviceid'])) {
        try {
            $res = _zenith_api($params)->lookupByService((int)$params['serviceid']);
            if (!empty($res['data']['uuid'])) {
                return $res['data']['uuid'];
            }
        } catch (\Exception $e) {
            logModuleCall('zenith', 'LookupByService', ['serviceid' => $params['serviceid']], $e->getMessage());
        }
    }
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
            'CentOS 8'             => (int)($params['configoption13'] ?? 0),
            'Ubuntu 25.04'         => (int)($params['configoption14'] ?? 0),
            'Ubuntu 26.04'         => (int)($params['configoption15'] ?? 0),
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

        $cpuBarColor = $cpuPct > 85 ? '#ef4444' : ($cpuPct > 60 ? '#f59e0b' : '#6366f1');
        $ramBarColor = $ramPct > 85 ? '#ef4444' : ($ramPct > 60 ? '#f59e0b' : '#3b82f6');

        $statusColors = [
            'running'   => ['bg' => '#052e16', 'border' => '#16a34a', 'text' => '#4ade80', 'dot' => '●'],
            'stopped'   => ['bg' => '#1e293b', 'border' => '#475569', 'text' => '#94a3b8', 'dot' => '○'],
            'suspended' => ['bg' => '#2d1b00', 'border' => '#d97706', 'text' => '#fbbf24', 'dot' => '⏸'],
            'error'     => ['bg' => '#2d0a0a', 'border' => '#dc2626', 'text' => '#f87171', 'dot' => '✕'],
            'creating'  => ['bg' => '#0c1a2e', 'border' => '#3b82f6', 'text' => '#60a5fa', 'dot' => '⟳'],
        ];
        $sc = $statusColors[$statusLower] ?? $statusColors['stopped'];

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
<div style="display:inline-flex;align-items:center;gap:12px;background:#0f172a;border-radius:10px;padding:12px 18px;border:1px solid #1e293b;">
    <span style="background:' . $sc['bg'] . ';border:1px solid ' . $sc['border'] . ';color:' . $sc['text'] . ';padding:5px 14px;border-radius:20px;font-size:13px;font-weight:700;letter-spacing:.03em;">
        ' . $sc['dot'] . ' ' . strtoupper($status) . '
    </span>
    <div style="width:1px;height:28px;background:#334155;"></div>
    <button type="button" onclick="zenithPower(\'start\')" ' . ($isRunning ? 'disabled' : '') . '
        style="padding:7px 16px;border-radius:7px;font-size:13px;font-weight:700;border:none;cursor:pointer;
               background:' . ($isRunning ? '#1e293b' : '#15803d') . ';color:' . ($isRunning ? '#334155' : '#fff') . ';">
        &#9654; Start
    </button>
    <button type="button" onclick="zenithPower(\'restart\',\'Reboot this VPS?\')" ' . (!$isRunning ? 'disabled' : '') . '
        style="padding:7px 16px;border-radius:7px;font-size:13px;font-weight:700;border:none;cursor:pointer;
               background:' . (!$isRunning ? '#1e293b' : '#1d4ed8') . ';color:' . (!$isRunning ? '#334155' : '#fff') . ';">
        &#8635; Reboot
    </button>
    <button type="button" onclick="zenithPower(\'stop\',\'Stop this VPS?\')" ' . (!$isRunning ? 'disabled' : '') . '
        style="padding:7px 16px;border-radius:7px;font-size:13px;font-weight:700;border:none;cursor:pointer;
               background:' . (!$isRunning ? '#1e293b' : '#b91c1c') . ';color:' . (!$isRunning ? '#334155' : '#fff') . ';">
        &#9646;&#9646; Stop
    </button>
</div>';

        // ── Stat Tiles ───────────────────────────────────────────────────────
        $osName = htmlspecialchars($data['template_name'] ?? 'N/A');

        // span: how many of 8 grid columns this tile occupies (2+1+1+1+2+1 = 8)
        $tiles = [
            ['IP Address', $ip ?: '—',                       '#6366f1', '#eef2ff', 'monospace', 2],
            ['CPU',        ($data['cpu'] ?? '—') . ' vCPU',  '#7c3aed', '#f5f3ff', 'inherit',   1],
            ['RAM',        $ramTotalGb,                       '#0369a1', '#eff6ff', 'inherit',   1],
            ['Disk',       $diskTotal . ' GB',                '#0f766e', '#f0fdfa', 'inherit',   1],
            ['OS',         $osName,                           '#b45309', '#fffbeb', 'inherit',   2],
            ['UUID',       substr($uuid, 0, 18) . '…',        '#64748b', '#f8fafc', 'monospace', 1],
        ];

        $infoHtml = '<div style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;max-width:800px;">';
        foreach ($tiles as [$label, $value, $accent, $bg, $ff, $span]) {
            $spanStyle = $span > 1 ? "grid-column:span {$span};" : '';
            $infoHtml .= '
<div style="' . $spanStyle . 'background:' . $bg . ';border:1px solid ' . $accent . '30;border-left:4px solid ' . $accent . ';border-radius:8px;padding:9px 12px;overflow:hidden;" title="' . htmlspecialchars($value) . '">
    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:' . $accent . ';margin-bottom:3px;">' . $label . '</div>
    <div style="font-size:14px;font-weight:800;color:#0f172a;font-family:' . $ff . ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' . htmlspecialchars($value) . '</div>
</div>';
        }
        $infoHtml .= '</div>';

        // ── Resource Bars (hidden panel) ─────────────────────────────────────
        if ($isRunning) {
            $statsInner = '
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:10px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;">CPU Usage</span>
        <span style="font-size:26px;font-weight:900;color:' . $cpuBarColor . ';">' . $cpuPct . '%</span>
    </div>
    <div style="background:#e2e8f0;border-radius:6px;height:16px;overflow:hidden;">
        <div style="background:linear-gradient(90deg,' . $cpuBarColor . ',' . $cpuBarColor . 'aa);width:' . max($cpuPct, 2) . '%;height:16px;border-radius:6px;"></div>
    </div>
</div>
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;">
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;">
        <span style="font-size:13px;font-weight:700;color:#374151;text-transform:uppercase;letter-spacing:.05em;">RAM Usage</span>
        <span style="font-size:16px;font-weight:800;color:' . $ramBarColor . ';">' . $ramUsedGb . ' <span style="font-size:12px;font-weight:500;color:#94a3b8;">/ ' . $ramTotalGb . '</span></span>
    </div>
    <div style="background:#e2e8f0;border-radius:6px;height:16px;overflow:hidden;">
        <div style="background:linear-gradient(90deg,' . $ramBarColor . ',' . $ramBarColor . 'aa);width:' . max($ramPct, 2) . '%;height:16px;border-radius:6px;"></div>
    </div>
    <div style="text-align:right;font-size:11px;color:#94a3b8;margin-top:4px;">' . $ramPct . '% used</div>
</div>';
        } else {
            $statsInner = '<div style="background:#f1f5f9;border-radius:8px;padding:14px;color:#64748b;font-size:13px;font-weight:600;border-left:4px solid #cbd5e1;">
                VPS is ' . $status . ' — stats unavailable while powered off.</div>';
        }

        // ── PTR Records (hidden panel) ────────────────────────────────────────
        $rdnsInner  = '';
        $rdnsCount  = 0;
        try {
            $rdnsList  = $api->getRdns($uuid);
            $rdnsCount = count($rdnsList);
            if (!empty($rdnsList)) {
                foreach ($rdnsList as $entry) {
                    $ipAddr    = htmlspecialchars($entry['ip'] ?? '');
                    $ptr       = htmlspecialchars($entry['ptr'] ?? '');
                    $fieldName = 'rdns_' . str_replace(['.', ':'], '_', $ipAddr);
                    $errNote   = isset($entry['error'])
                        ? '<span style="color:#ef4444;font-size:11px;margin-left:6px;">(' . htmlspecialchars($entry['error']) . ')</span>' : '';
                    $rdnsInner .= '
<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6366f1;margin-bottom:6px;">&#127760; ' . $ipAddr . $errNote . '</div>
    <input type="text" name="' . $fieldName . '" value="' . $ptr . '" placeholder="e.g. mail.example.com"
        style="width:100%;padding:7px 10px;font-family:monospace;font-size:13px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box;color:#0f172a;background:#fff;" />
</div>';
                }
                $rdnsInner .= '
<button type="submit" onclick="document.getElementById(\'zenith_power_action\').value=\'\';"
    style="margin-top:4px;padding:9px 20px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;">
    &#10003; Save PTR Records
</button>';
            } else {
                $rdnsInner = '<p style="color:#64748b;font-size:13px;">No IPs assigned.</p>';
            }
        } catch (Exception $e) {
            $rdnsInner = '<p style="color:#ef4444;">' . htmlspecialchars($e->getMessage()) . '</p>';
        }

        // ── Accordion row ────────────────────────────────────────────────────
        $accordionHtml = '
<script>
function zenithToggle(id) {
    var panel = document.getElementById("zenith_panel_" + id);
    var icon  = document.getElementById("zenith_icon_"  + id);
    if (!panel) return;
    var open = panel.style.display !== "none";
    panel.style.display = open ? "none" : "block";
    icon.innerHTML = open ? "&#9660;" : "&#9650;";
}
</script>

<div style="display:flex;gap:10px;max-width:490px;margin-bottom:10px;">
    <div onclick="zenithToggle(\'stats\')" style="flex:1;cursor:pointer;background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;font-weight:700;color:#0369a1;">&#128202; Resource Usage</span>
        <span id="zenith_icon_stats" style="color:#0369a1;font-size:11px;">&#9660;</span>
    </div>
    <div onclick="zenithToggle(\'rdns\')" style="flex:1;cursor:pointer;background:#f5f3ff;border:1px solid #c4b5fd;border-radius:10px;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-size:13px;font-weight:700;color:#6d28d9;">&#127760; rDNS / PTR <span style="font-weight:500;opacity:.8;">(' . $rdnsCount . ')</span></span>
        <span id="zenith_icon_rdns" style="color:#6d28d9;font-size:11px;">&#9660;</span>
    </div>
</div>

<div id="zenith_panel_stats" style="display:none;max-width:490px;margin-bottom:10px;">
    ' . $statsInner . '
</div>

<div id="zenith_panel_rdns" style="display:none;max-width:490px;">
    ' . $rdnsInner . '
</div>';

        return [
            'Power Controls' => $powerHtml,
            'VPS Details'    => $infoHtml,
            ' '              => $accordionHtml,
        ];

    } catch (Exception $e) {
        return ['Zenith Error' => htmlspecialchars($e->getMessage())];
    }
}

function zenith_AdminServicesTabFieldsSave(array $params): string {
    $uuid = _zenith_getuuid($params);
    if (!$uuid) return '';

    $api         = _zenith_api($params);
    // Read directly from $_POST — WHMCS does NOT map our custom embedded
    // <input> fields into $params['modulefields'] (only label-keyed fields).
    $powerAction = trim($_POST['zenith_power_action'] ?? '');

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

    $errors  = [];
    $updated = 0;
    foreach ($rdnsList as $entry) {
        $ipAddr    = $entry['ip'] ?? '';
        $fieldName = 'rdns_' . str_replace(['.', ':'], '_', $ipAddr);
        if (!array_key_exists($fieldName, $_POST)) continue;
        $newPtr = trim($_POST[$fieldName]);
        $oldPtr = $entry['ptr'] ?? '';
        if ($newPtr === $oldPtr) continue;
        try {
            $api->updateRdns($uuid, $ipAddr, $newPtr);
            logActivity("Zenith: Admin updated PTR for {$ipAddr} on VPS {$uuid} → " . ($newPtr ?: '(cleared)'), $params['userid']);
            $updated++;
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
