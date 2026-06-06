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
  <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:16px;margin-bottom:16px;">
    <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:12px;">Power Controls</div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;">

      {* Start *}
      <form method="post" action="clientarea.php" style="margin:0;">
        <input type="hidden" name="token"         value="{$whmcs_token}" />
        <input type="hidden" name="action"        value="productdetails" />
        <input type="hidden" name="id"            value="{$serviceid}" />
        <input type="hidden" name="zenith_action" value="start" />
        <button type="submit"
          {if $status_raw != 'stopped' && $status_raw != 'suspended' && $status_raw != 'error'}disabled{/if}
          style="width:100%;padding:10px 8px;border:1px solid {if $status_raw == 'stopped' || $status_raw == 'suspended' || $status_raw == 'error'}rgba(34,197,94,0.4){else}rgba(255,255,255,0.08){/if};border-radius:10px;background:{if $status_raw == 'stopped' || $status_raw == 'suspended' || $status_raw == 'error'}rgba(34,197,94,0.15){else}rgba(255,255,255,0.04){/if};color:{if $status_raw == 'stopped' || $status_raw == 'suspended' || $status_raw == 'error'}#4ade80{else}#334155{/if};font-size:13px;font-weight:600;cursor:{if $status_raw == 'stopped' || $status_raw == 'suspended' || $status_raw == 'error'}pointer{else}not-allowed{/if};display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;transition:all .15s;">
          <span style="font-size:15px;">&#9654;</span> Start
        </button>
      </form>

      {* Stop *}
      <form method="post" action="clientarea.php" style="margin:0;">
        <input type="hidden" name="token"         value="{$whmcs_token}" />
        <input type="hidden" name="action"        value="productdetails" />
        <input type="hidden" name="id"            value="{$serviceid}" />
        <input type="hidden" name="zenith_action" value="stop" />
        <button type="submit"
          {if $status_raw != 'running'}disabled{/if}
          onclick="{if $status_raw == 'running'}return confirm('Stop this VPS?'){/if}"
          style="width:100%;padding:10px 8px;border:1px solid {if $status_raw == 'running'}rgba(248,113,113,0.4){else}rgba(255,255,255,0.08){/if};border-radius:10px;background:{if $status_raw == 'running'}rgba(239,68,68,0.12){else}rgba(255,255,255,0.04){/if};color:{if $status_raw == 'running'}#f87171{else}#334155{/if};font-size:13px;font-weight:600;cursor:{if $status_raw == 'running'}pointer{else}not-allowed{/if};display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;transition:all .15s;">
          <span style="font-size:15px;">&#9646;&#9646;</span> Stop
        </button>
      </form>

      {* Restart *}
      <form method="post" action="clientarea.php" style="margin:0;">
        <input type="hidden" name="token"         value="{$whmcs_token}" />
        <input type="hidden" name="action"        value="productdetails" />
        <input type="hidden" name="id"            value="{$serviceid}" />
        <input type="hidden" name="zenith_action" value="restart" />
        <button type="submit"
          {if $status_raw != 'running'}disabled{/if}
          onclick="{if $status_raw == 'running'}return confirm('Restart this VPS?'){/if}"
          style="width:100%;padding:10px 8px;border:1px solid {if $status_raw == 'running'}rgba(99,102,241,0.4){else}rgba(255,255,255,0.08){/if};border-radius:10px;background:{if $status_raw == 'running'}rgba(99,102,241,0.12){else}rgba(255,255,255,0.04){/if};color:{if $status_raw == 'running'}#818cf8{else}#334155{/if};font-size:13px;font-weight:600;cursor:{if $status_raw == 'running'}pointer{else}not-allowed{/if};display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;transition:all .15s;">
          <span style="font-size:15px;">&#8635;</span> Restart
        </button>
      </form>

    </div>
    {if $status_raw != 'running' && $status_raw != 'stopped' && $status_raw != 'suspended' && $status_raw != 'error'}
    <p style="margin:8px 0 0;font-size:12px;color:#475569;text-align:center;">VPS is {$status} — please wait</p>
    {/if}
  </div>

  {* Reinstall OS *}
  {if $status_raw == 'running' || $status_raw == 'stopped'}
  <div style="border-top:1px solid rgba(255,255,255,0.07);padding-top:16px;margin-bottom:16px;">
    <div style="font-size:11px;color:#475569;text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px;">Reinstall OS</div>
    <div style="font-size:12px;color:#64748b;margin-bottom:12px;">Wipes all data and reinstalls the selected OS.</div>
    <form method="post" action="clientarea.php">
      <input type="hidden" name="token"         value="{$whmcs_token}" />
      <input type="hidden" name="action"        value="productdetails" />
      <input type="hidden" name="id"            value="{$serviceid}" />
      <input type="hidden" name="zenith_action" value="reinstall" />

      {if $templates_list}
      <div style="margin-bottom:10px;">
        <label style="display:block;font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Operating System</label>
        <div style="display:flex;flex-direction:column;gap:5px;max-height:220px;overflow-y:auto;padding-right:2px;">
          <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.03);">
            <input type="radio" name="reinstall_template_id" value="0" checked style="accent-color:#6366f1;flex-shrink:0;" />
            <span style="font-size:13px;color:#94a3b8;">Keep current OS</span>
          </label>
          {foreach from=$templates_list item=tpl}
          <label style="display:flex;align-items:center;gap:10px;padding:9px 12px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;cursor:pointer;background:rgba(255,255,255,0.03);">
            <input type="radio" name="reinstall_template_id" value="{$tpl.id}" style="accent-color:#6366f1;flex-shrink:0;" />
            <span style="font-size:13px;color:#e2e8f0;">{$tpl.name}</span>
          </label>
          {/foreach}
        </div>
      </div>
      {/if}

      <div style="margin-bottom:10px;">
        <label style="display:block;font-size:11px;color:#64748b;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">New Root Password</label>
        <input type="password" name="reinstall_password" placeholder="Minimum 8 characters"
          style="width:100%;background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:9px 12px;color:#f1f5f9;font-size:13px;outline:none;box-sizing:border-box;" />
      </div>

      <button type="submit" onclick="return confirm('This will ERASE all data and reinstall the OS. Are you absolutely sure?')"
        style="width:100%;padding:11px;background:rgba(185,28,28,0.8);border:1px solid rgba(239,68,68,0.3);border-radius:10px;color:#fff;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:.02em;">
        &#9888; Reinstall Now
      </button>
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
