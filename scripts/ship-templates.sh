#!/bin/bash
# ship-templates.sh — run ON Slave 62 (184.107.3.207).
# Ships the Zenith KVM templates (9000-9008) to another Proxmox node and builds
# them there. One-time prerequisite per target node:
#     ssh-copy-id root@TARGET_IP        (enter that node's root password once)
# Then:
#     /root/kvm-templates/ship-templates.sh TARGET_IP
set -euo pipefail

TARGET=${1:-}
[ -n "$TARGET" ] || { echo "Usage: $0 <target-node-ip>"; exit 1; }
DIR=/root/kvm-templates
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@$TARGET"

echo "==> [1/4] Checking SSH access to $TARGET"
$SSH "hostname && pveversion" || {
  echo "FATAL: SSH failed. Run first:  ssh-copy-id root@$TARGET"; exit 1; }

echo "==> [2/4] Checking disk space on $TARGET (need ~10GB in /root + ~45GB in /var/lib/vz)"
$SSH "df -h /root /var/lib/vz | tail -2"

echo "==> [3/4] Syncing images (~8GB — takes a few minutes)"
$SSH "mkdir -p $DIR"
rsync -a --info=progress2 \
  "$DIR/jammy-server-cloudimg-amd64.img" \
  "$DIR/noble-server-cloudimg-amd64.img" \
  "$DIR/debian-12-genericcloud-amd64.qcow2" \
  "$DIR/debian-13-genericcloud-amd64.qcow2" \
  "$DIR/AlmaLinux-8-GenericCloud-latest.x86_64.qcow2" \
  "$DIR/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2" \
  "$DIR/AlmaLinux-10-GenericCloud-latest.x86_64.qcow2" \
  "$DIR/Rocky-9-GenericCloud-Base.latest.x86_64.qcow2" \
  "$DIR/Rocky-10-GenericCloud-Base.latest.x86_64.qcow2" \
  "$DIR/build-remote.sh" \
  "root@$TARGET:$DIR/"

# SystemRescue ISO — used for KVM rescue mode (worker boots VMs from local:iso/systemrescue.iso)
if [ -f /var/lib/vz/template/iso/systemrescue.iso ]; then
  echo "==> [3b/4] Syncing SystemRescue ISO (KVM rescue mode)"
  $SSH "mkdir -p /var/lib/vz/template/iso"
  rsync -a --info=progress2 /var/lib/vz/template/iso/systemrescue.iso "root@$TARGET:/var/lib/vz/template/iso/"
fi

echo "==> [4/4] Building templates on $TARGET"
$SSH "chmod +x $DIR/build-remote.sh && $DIR/build-remote.sh"

echo ""
echo "DONE — $TARGET is ready for KVM VPS creation."
echo "(Optional cleanup on target: rm $DIR/*.img $DIR/*.qcow2 frees ~8GB)"
