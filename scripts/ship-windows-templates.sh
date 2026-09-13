#!/bin/bash
# ship-windows-templates.sh — run ON Slave 62 (184.107.3.207).
# Ships the Windows KVM templates (9009 = Server 2022, 9010 = Server 2025, 9011 = Server 2019) to another
# Proxmox node. Requires key access (same as ship-templates.sh):
#     ssh-copy-id root@TARGET_IP        (once per node)
# Then:
#     /root/kvm-templates/ship-windows-templates.sh TARGET_IP
#
# Disks are sparse 64G raw (~9-11G real each); transfer uses rsync -S. The target
# needs ~35GB temporary space in /root and ~35GB in /var/lib/vz.
set -euo pipefail

TARGET=${1:-}
[ -n "$TARGET" ] || { echo "Usage: $0 <target-node-ip>"; exit 1; }
SSH="ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new root@$TARGET"
DIR=/root/kvm-templates/windows-ship

VMIDS=(9009 9010 9011)
NAMES=(tpl-win2022 tpl-win2025 tpl-win2019)
SRCS=(/var/lib/vz/images/9009/base-9009-disk-0.raw /var/lib/vz/images/9010/base-9010-disk-0.raw /var/lib/vz/images/9011/base-9011-disk-0.raw)
# Proxmox ostype must match the guest: win11 covers Server 2022/2025, win10 covers Server 2016/2019.
OSTYPES=(win11 win11 win10)

echo "==> [1/3] Checking SSH access to $TARGET"
$SSH "hostname && pveversion" || { echo "FATAL: SSH failed. Run first: ssh-copy-id root@$TARGET"; exit 1; }
$SSH "mkdir -p $DIR"

for i in "${!VMIDS[@]}"; do
  VMID=${VMIDS[$i]}; NAME=${NAMES[$i]}; SRC=${SRCS[$i]}; WIN_OSTYPE=${OSTYPES[$i]}

  if $SSH "qm config $VMID 2>/dev/null | grep -q '^name: $NAME'"; then
    echo "OK   [$VMID] $NAME already present on $TARGET — skipping"
    continue
  fi
  if $SSH "qm status $VMID >/dev/null 2>&1 || pct status $VMID >/dev/null 2>&1"; then
    echo "CONFLICT [$VMID]: VMID in use by something else on $TARGET — resolve manually, skipping"
    continue
  fi
  [ -f "$SRC" ] || { echo "FAIL [$VMID]: source disk missing: $SRC"; continue; }

  echo "==> [2/3] Syncing $NAME disk (sparse, ~10GB real)"
  rsync -S --info=progress2 "$SRC" "root@$TARGET:$DIR/$NAME.raw"

  echo "==> [3/3] Building $NAME ($VMID) on $TARGET"
  $SSH "qm create $VMID --name $NAME --ostype $WIN_OSTYPE --memory 4096 --cores 4 --cpu host \
      --scsihw virtio-scsi-single --net0 virtio,bridge=vmbr0,firewall=1 \
      --agent enabled=1 \
    && qm importdisk $VMID $DIR/$NAME.raw local --format raw >/dev/null \
    && qm set $VMID --scsi0 local:$VMID/vm-$VMID-disk-0.raw,discard=on \
    && qm set $VMID --boot order=scsi0 \
    && qm set $VMID --ciuser Administrator \
    && qm template $VMID \
    && rm -f $DIR/$NAME.raw \
    && echo \"OK   [$VMID] $NAME\"" \
  || { echo "FAIL [$VMID] $NAME — cleaning up"; $SSH "qm destroy $VMID --purge 2>/dev/null; rm -f $DIR/$NAME.raw"; }
done

echo ""
echo "DONE — Windows templates shipped to $TARGET (panel needs no changes; same VMIDs everywhere)."
