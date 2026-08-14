# Zenith Windows template setup — runs once at first logon after unattended install.
# Installs virtio drivers, QEMU guest agent, cloudbase-init; enables RDP; sysprep+shutdown.
Start-Transcript -Path C:\zenith-build.log -Append

function Install-Msi($path, $extraArgs = '') {
  # Retry while Windows Installer is busy with post-OOBE tasks (1618)
  for ($i = 1; $i -le 10; $i++) {
    $p = Start-Process msiexec -ArgumentList "/i `"$path`" /qn /norestart $extraArgs" -Wait -PassThru
    Write-Host "msiexec $path attempt $i exit $($p.ExitCode)"
    if ($p.ExitCode -in 0, 3010) { return $true }
    Start-Sleep -Seconds 30
  }
  return $false
}

$cds    = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 5 } | ForEach-Object { $_.DeviceID }
$virtio = $cds | Where-Object { Test-Path "$_\virtio-win-gt-x64.msi" } | Select-Object -First 1
$zen    = $cds | Where-Object { Test-Path "$_\zenith\setup.ps1" }     | Select-Object -First 1
Write-Host "virtio drive: $virtio  zenith drive: $zen"

# 1. virtio drivers (vioscsi, netkvm, balloon, ...). Dummy scsi disk is attached so
#    vioscsi binds and becomes boot-capable before we flip the OS disk to scsi0.
if (-not (Install-Msi "$virtio\virtio-win-gt-x64.msi")) { Write-Host 'FATAL virtio'; Stop-Transcript; exit 1 }

# 2. QEMU guest agent
if (-not (Install-Msi "$virtio\guest-agent\qemu-ga-x86_64.msi")) { Write-Host 'FATAL qemu-ga'; Stop-Transcript; exit 1 }

# 3. cloudbase-init
if (-not (Install-Msi "$zen\zenith\CloudbaseInitSetup_Stable_x64.msi")) { Write-Host 'FATAL cloudbase'; Stop-Transcript; exit 1 }

# 4. cloudbase-init config — proven settings: no SetHostNamePlugin (it forced reboots),
#    allow_reboot=false, no forced password change. Password is ALSO set by the panel
#    worker via guest agent, so SetUserPassword here is belt-and-braces.
$conf = @'
[DEFAULT]
username=Administrator
groups=Administrators
inject_user_password=true
first_logon_behaviour=no
config_drive_raw_hhd=true
config_drive_cdrom=true
config_drive_vfat=true
metadata_services=cloudbaseinit.metadata.services.configdrive.ConfigDriveService
plugins=cloudbaseinit.plugins.common.mtu.MTUPlugin,cloudbaseinit.plugins.common.networkconfig.NetworkConfigPlugin,cloudbaseinit.plugins.windows.extendvolumes.ExtendVolumesPlugin,cloudbaseinit.plugins.common.setuserpassword.SetUserPasswordPlugin
allow_reboot=false
mtu_use_dhcp_config=false
verbose=true
debug=true
log_dir=C:\Program Files\Cloudbase Solutions\Cloudbase-Init\log
log_file=cloudbase-init.log
'@
$confDir = 'C:\Program Files\Cloudbase Solutions\Cloudbase-Init\conf'
Set-Content -Path "$confDir\cloudbase-init.conf" -Value $conf -Encoding ASCII
Set-Content -Path "$confDir\cloudbase-init-unattend.conf" -Value $conf -Encoding ASCII

# 5. Enable RDP + firewall
reg add "HKLM\SYSTEM\CurrentControlSet\Control\Terminal Server" /v fDenyTSConnections /t REG_DWORD /d 0 /f
netsh advfirewall firewall set rule group="remote desktop" new enable=Yes

# 6. Housekeeping
powercfg /h off
netsh advfirewall firewall add rule name="ICMP Allow" protocol=icmpv4:8,any dir=in action=allow

# 7. NO sysprep — sysprep during the first OOBE logon leaves setup state inconsistent
#    ("Windows could not start the installation process" on clone boot). Clones share
#    the template SID/hostname, which is fine for standalone RDP VPSes; the
#    cloudbase-init service applies IP + password per clone from the config drive.
#    Clean up autologon + cached answer files so clones boot straight to the login screen.
reg add "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v AutoAdminLogon /t REG_SZ /d 0 /f
reg delete "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" /v DefaultPassword /f 2>$null
Remove-Item -Force -ErrorAction SilentlyContinue C:\Windows\Panther\unattend.xml
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue C:\Windows\Panther\Unattend
net user Administrator /expires:never
Write-Host 'Setup complete — shutting down for templating'
Stop-Transcript
Stop-Computer -Force
