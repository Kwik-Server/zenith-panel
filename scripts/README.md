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

## Scripts

- `ship-templates.sh` — run on Slave 62; rsyncs images + `build-remote.sh` to a target node and builds there.
- `build-remote.sh` — runs on the target; creates templates from the pre-customized images (no libguestfs needed).
- `build-kvm-template.sh` — full build from a *pristine* cloud image (runs `virt-customize`; needs `libguestfs-tools`).
  Only used when adding a **new OS**: download the official cloud image to `/root/kvm-templates/` on Slave 62, run
  `./build-kvm-template.sh <new-vmid> <name> <image-file>`, add the image+VMID to the lists in both
  `ship-templates.sh` and `build-remote.sh`, then ship to other nodes and register the VMID in the panel Templates page.
