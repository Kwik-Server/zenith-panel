<div style="background:#0f172a;border-radius:16px;padding:24px;color:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin-top:10px;">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">
    <div>
      <div style="font-size:18px;font-weight:700;color:#f8fafc;">&#9889; {$hostname}</div>
      <div style="font-size:12px;color:#475569;margin-top:2px;">VPS Server &mdash; Kwik Server Cloud</div>
    </div>
    <span style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:13px;font-weight:600;background:{$status_bg};color:{$status_color};">
      {$status_dot} {$status}
    </span>
  </div>

  {if $cpu}
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
    <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:20px;font-weight:700;">{$cpu}</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">vCPU</div>
    </div>
    <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:20px;font-weight:700;">{$ram}</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">RAM</div>
    </div>
    <div style="background:rgba(255,255,255,0.05);border-radius:10px;padding:12px;text-align:center;">
      <div style="font-size:20px;font-weight:700;">{$disk}</div>
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;">Disk</div>
    </div>
  </div>
  {/if}

  <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:12px;margin-bottom:16px;">
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
      <span style="color:#64748b;">&#127757; IP Address</span>
      <span style="color:#e2e8f0;font-family:monospace;">{$ip_address}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;">
      <span style="color:#64748b;">&#128421; OS</span>
      <span style="color:#e2e8f0;">{$os_name}</span>
    </div>
  </div>

  {if $action_message}
  <div style="margin-bottom:14px;padding:10px 14px;border-radius:10px;background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.25);color:#86efac;font-size:13px;">
    &#10003; {$action_message}
  </div>
  {/if}
  {if $action_error}
  <div style="margin-bottom:14px;padding:10px 14px;border-radius:10px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;font-size:13px;">
    &#9888; {$action_error}
  </div>
  {/if}

  {* Power Controls *}
  <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;margin-bottom:16px;">
    <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">Power Controls</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">

      {if $status_raw == 'stopped' || $status_raw == 'suspended' || $status_raw == 'error'}
      <form method="post" action="clientarea.php" style="margin:0;">
        <input type="hidden" name="token"         value="{$whmcs_token}" />
        <input type="hidden" name="action"        value="productdetails" />
        <input type="hidden" name="id"            value="{$serviceid}" />
        <input type="hidden" name="zenith_action" value="start" />
        <button type="submit" style="padding:8px 16px;background:#16a34a;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">
          &#9654; Start
        </button>
      </form>
      {/if}

      {if $status_raw == 'running'}
      <form method="post" action="clientarea.php" style="margin:0;">
        <input type="hidden" name="token"         value="{$whmcs_token}" />
        <input type="hidden" name="action"        value="productdetails" />
        <input type="hidden" name="id"            value="{$serviceid}" />
        <input type="hidden" name="zenith_action" value="stop" />
        <button type="submit" onclick="return confirm('Stop this VPS?')"
          style="padding:8px 16px;background:#475569;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">
          &#9646;&#9646; Stop
        </button>
      </form>
      <form method="post" action="clientarea.php" style="margin:0;">
        <input type="hidden" name="token"         value="{$whmcs_token}" />
        <input type="hidden" name="action"        value="productdetails" />
        <input type="hidden" name="id"            value="{$serviceid}" />
        <input type="hidden" name="zenith_action" value="restart" />
        <button type="submit" onclick="return confirm('Restart this VPS?')"
          style="padding:8px 16px;background:#2563eb;border:none;border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">
          &#8635; Restart
        </button>
      </form>
      {/if}

      {if $status_raw != 'running' && $status_raw != 'stopped' && $status_raw != 'suspended' && $status_raw != 'error'}
      <span style="font-size:13px;color:#64748b;padding:8px 0;">
        &#8987; VPS is {$status} — power controls unavailable
      </span>
      {/if}

    </div>
  </div>

  {* Reinstall OS *}
  {if $status_raw == 'running' || $status_raw == 'stopped'}
  <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;margin-bottom:16px;">
    <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:6px;">Reinstall OS</div>
    <div style="font-size:12px;color:#ef4444;margin-bottom:8px;">&#9888; This will erase all data on the VPS.</div>
    <form method="post" action="clientarea.php">
      <input type="hidden" name="token"         value="{$whmcs_token}" />
      <input type="hidden" name="action"        value="productdetails" />
      <input type="hidden" name="id"            value="{$serviceid}" />
      <input type="hidden" name="zenith_action" value="reinstall" />
      <div style="display:flex;gap:8px;">
        <input type="password" name="reinstall_password" placeholder="New root password (min 8 chars)"
          style="flex:1;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;color:#f1f5f9;font-size:12px;outline:none;box-sizing:border-box;" />
        <button type="submit" onclick="return confirm('This will ERASE all data and reinstall the OS. Are you sure?')"
          style="padding:8px 16px;background:#b91c1c;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">
          Reinstall
        </button>
      </div>
    </form>
  </div>
  {/if}

  {if $rdns_list}
  <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:14px;margin-bottom:16px;">
    <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;font-weight:600;margin-bottom:10px;">rDNS / PTR Records</div>
    {foreach from=$rdns_list item=entry}
    <div style="margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;font-size:12px;">
        <span style="color:#94a3b8;font-family:monospace;">{$entry.ip}</span>
        <span style="color:{if $entry.ptr}#e2e8f0{else}#475569{/if};font-family:monospace;">{if $entry.ptr}{$entry.ptr}{else}<em>not set</em>{/if}</span>
      </div>
      {if !$entry.error}
      <form method="post" action="clientarea.php" style="display:flex;gap:8px;">
        <input type="hidden" name="token"        value="{$whmcs_token}" />
        <input type="hidden" name="action"       value="productdetails" />
        <input type="hidden" name="id"           value="{$serviceid}" />
        <input type="hidden" name="zenith_action" value="update_rdns" />
        <input type="hidden" name="rdns_ip"      value="{$entry.ip}" />
        <input type="text"   name="rdns_ptr"  value="{$entry.ptr}"
          placeholder="e.g. mail.example.com"
          style="flex:1;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:8px 10px;color:#f1f5f9;font-size:12px;font-family:monospace;outline:none;box-sizing:border-box;" />
        <button type="submit"
          style="padding:8px 16px;background:#6366f1;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;">
          Save PTR
        </button>
      </form>
      {else}
      <div style="font-size:11px;color:#f87171;padding:4px 0;">{$entry.error}</div>
      {/if}
    </div>
    {/foreach}
  </div>
  {/if}

  <a href="{$login_url}" target="_blank" style="display:block;width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-align:center;text-decoration:none;box-sizing:border-box;">
    &#10141; Manage VPS
  </a>

</div>
