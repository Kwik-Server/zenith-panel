#!/bin/bash
# build-kvm-template.sh — build one Zenith KVM cloud-init template
# Usage: ./build-kvm-template.sh <vmid> <name> <image-file>
set -euo pipefail

VMID="$1"
NAME="$2"
IMG="/root/kvm-templates/$3"
STORAGE="local"

[ -f "$IMG" ] || { echo "Image not found: $IMG"; exit 1; }

# Refuse to clobber an existing VM
if qm status "$VMID" &>/dev/null; then
  echo "VMID $VMID already exists — skipping create. Delete it first if rebuilding: qm destroy $VMID"
  exit 1
fi

echo "=== [$VMID] $NAME: customizing image ==="
# Bake in: guest agent, root SSH password login, cloud-init root enabled, fresh machine-id
virt-customize -a "$IMG" \
  --install qemu-guest-agent \
  --run-command 'mkdir -p /etc/ssh/sshd_config.d' \
  --write '/etc/ssh/sshd_config.d/01-zenith.conf:PermitRootLogin yes
PasswordAuthentication yes' \
  --run-command 'sed -i "s/^#\?PermitRootLogin.*/PermitRootLogin yes/" /etc/ssh/sshd_config' \
  --run-command 'sed -i "s/^#\?PasswordAuthentication.*/PasswordAuthentication yes/" /etc/ssh/sshd_config' \
  --run-command 'sed -i "s/^disable_root:.*/disable_root: false/" /etc/cloud/cloud.cfg || true' \
  --run-command 'sed -i "s/^ssh_pwauth:.*/ssh_pwauth: true/" /etc/cloud/cloud.cfg || true' \
  --run-command 'systemctl enable qemu-guest-agent || true' \
  --run-command 'truncate -s 0 /etc/machine-id && if [ -d /var/lib/dbus ]; then rm -f /var/lib/dbus/machine-id && ln -s /etc/machine-id /var/lib/dbus/machine-id; fi'

echo "=== [$VMID] $NAME: creating VM ==="
qm create "$VMID" \
  --name "$NAME" \
  --ostype l26 \
  --memory 2048 \
  --cores 2 \
  --cpu host \
  --net0 virtio,bridge=vmbr0,firewall=1 \
  --scsihw virtio-scsi-single \
  --agent enabled=1 \
  --serial0 socket

echo "=== [$VMID] $NAME: importing disk ==="
qm set "$VMID" --scsi0 "${STORAGE}:0,import-from=${IMG},discard=on"
qm set "$VMID" --boot order=scsi0

# ciuser=root is copied on clone, so the panel's cipassword sets the root password.
# NOTE: no cloud-init drive here on purpose — Zenith adds ide3:cloudinit itself on clone.
qm set "$VMID" --ciuser root

echo "=== [$VMID] $NAME: converting to template ==="
qm template "$VMID"
echo "=== [$VMID] $NAME: DONE ==="
