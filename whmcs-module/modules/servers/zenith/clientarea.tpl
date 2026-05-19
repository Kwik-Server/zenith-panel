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

  <a href="{$login_url}" target="_blank" style="display:block;width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;font-size:15px;font-weight:700;text-align:center;text-decoration:none;box-sizing:border-box;">
    &#10141; Manage VPS
  </a>

</div>
