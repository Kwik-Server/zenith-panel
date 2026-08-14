# KVM template scripts

Zenith clones KVM VPS from Proxmox templates at fixed VMIDs, identical on every node:

| VMID | Template | Notes |
|------|----------|-------|
| 9000 | Ubuntu 22.04 | |
| 9001 | Ubuntu 24.04 | |
| 9002 | Debian 12 | |
| 9003 | AlmaLinux 9 | |
| 9004 | AlmaLinux 8 | |
| 9005 | Debian 13 | |
| 9006 | Rocky Linux 9 | |
| 9007 | Rocky Linux 10 | needs x86-64-v3 (AVX2) host CPU |
| 9008 | AlmaLinux 10 | needs x86-64-v3 (AVX2) host CPU |

All templates are built from official cloud images with baked-in: qemu-guest-agent,
root SSH password login (`sshd_config.d/01-zenith.conf`), `disable_root: false`,
reset machine-id, and `ciuser=root` so the panel's `cipassword` sets the root password.
Deliberately **no cloud-init drive** on the template — the panel adds `ide3:cloudinit`
when cloning; a drive on the template would conflict.

The master copy of images + scripts lives on Slave 62 (184.107.3.207) in `/root/kvm-templates/`.

## Ship templates to a node (new or existing)

From Slave 62:

```bash
ssh-copy-id root@TARGET_NODE_IP                       # once per node, asks for its root password
/root/kvm-templates/ship-templates.sh TARGET_NODE_IP  # syncs images (~8GB) and builds 9000-9008
```

Safe to re-run: existing templates are skipped, occupied VMIDs are reported as
CONFLICT (never overwritten), nodes without AVX2 skip 9007/9008, and the `images`
content type is auto-enabled on `local` storage. No panel changes needed afterwards.

## Windows Server 2022 template (VMID 9009)

Built fully unattended from the eval ISO — assets in `windows/` (autounattend.xml, setup.ps1, go.cmd).
Rebuild procedure (on a node with the ISOs in /var/lib/vz/template/iso — win2022-eval.iso,
virtio-win.iso, zenith-unattend.iso; regenerate the latter with genisoimage from windows/ + the
Cloudbase MSI in a zenith/ subdir):

```bash
qm create 9009 --name tpl-win2022-build --ostype win11 --memory 6144 --cores 4 --cpu host \
  --scsihw virtio-scsi-single --sata0 local:64,format=raw --scsi1 local:1,format=raw \
  --net0 e1000,bridge=vmbr0,firewall=1 --ide2 local:iso/win2022-eval.iso,media=cdrom \
  --ide0 local:iso/virtio-win.iso,media=cdrom --ide1 local:iso/zenith-unattend.iso,media=cdrom \
  --boot 'order=ide2;sata0'
qm start 9009    # installs + configures itself, then powers off (~15 min)
# after shutdown: detach ISOs + dummy scsi1, move sata0 -> scsi0, net0 -> virtio,
# set --ciuser Administrator, qm template 9009  (see git history for exact commands)
```

Design notes: install goes to a SATA disk (no storage driver needed in WinPE); a dummy
virtio-scsi disk activates vioscsi so the OS disk can be flipped to scsi0 afterwards
(the panel resizes scsi0). NO sysprep — sysprep during the first OOBE logon breaks clone
boot ("Windows could not start the installation process"); clones share SID/hostname,
fine for standalone RDP VPSes. cloudbase-init applies IP + password per clone from the
panel's ide3 config drive, and the worker additionally forces the Administrator password
via the guest agent. Windows plans need disk >= 64GB (clones can only grow).

## Scripts

- `ship-templates.sh` — run on Slave 62; rsyncs images + `build-remote.sh` to a target node and builds there.
- `build-remote.sh` — runs on the target; creates templates from the pre-customized images (no libguestfs needed).
- `build-kvm-template.sh` — full build from a *pristine* cloud image (runs `virt-customize`; needs `libguestfs-tools`).
  Only used when adding a **new OS**: download the official cloud image to `/root/kvm-templates/` on Slave 62, run
  `./build-kvm-template.sh <new-vmid> <name> <image-file>`, add the image+VMID to the lists in both
  `ship-templates.sh` and `build-remote.sh`, then ship to other nodes and register the VMID in the panel Templates page.
