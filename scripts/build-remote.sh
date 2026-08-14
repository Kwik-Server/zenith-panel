#!/bin/bash
# build-remote.sh — runs ON a target Proxmox node.
# Creates Zenith KVM templates 9000-9008 from the pre-customized cloud images
# in /root/kvm-templates (shipped there by ship-templates.sh). No virt-customize
# needed — the images already contain qemu-guest-agent + root SSH config.
set -u

DIR=/root/kvm-templates
VMIDS=(9000 9001 9002 9003 9004 9005 9006 9007 9008)
NAMES=(tpl-ubuntu-2204 tpl-ubuntu-2404 tpl-debian-12 tpl-almalinux-9 tpl-almalinux-8 tpl-debian-13 tpl-rocky-9 tpl-rocky-10 tpl-almalinux-10)
IMGS=(jammy-server-cloudimg-amd64.img noble-server-cloudimg-amd64.img debian-12-genericcloud-amd64.qcow2 AlmaLinux-9-GenericCloud-latest.x86_64.qcow2 AlmaLinux-8-GenericCloud-latest.x86_64.qcow2 debian-13-genericcloud-amd64.qcow2 Rocky-9-GenericCloud-Base.latest.x86_64.qcow2 Rocky-10-GenericCloud-Base.latest.x86_64.qcow2 AlmaLinux-10-GenericCloud-latest.x86_64.qcow2)

command -v qm >/dev/null || { echo "FATAL: not a Proxmox node (qm not found)"; exit 1; }

# Ensure 'local' storage accepts VM images
CONTENT=$(awk '/^dir: local$/{f=1;next} /^[a-z]+:/{f=0} f && $1=="content"{print $2; exit}' /etc/pve/storage.cfg)
if ! echo "$CONTENT" | grep -q images; then
  echo "Enabling 'images' content on local storage (was: $CONTENT)"
  pvesm set local --content "${CONTENT:+$CONTENT,}images" || { echo "FATAL: could not enable images content"; exit 1; }
fi

# Rocky 10 / AlmaLinux 10 need x86-64-v3 (AVX2) on the host CPU
HAS_AVX2=0
grep -q avx2 /proc/cpuinfo && HAS_AVX2=1
[ $HAS_AVX2 -eq 0 ] && echo "WARN: CPU has no AVX2 — skipping Rocky 10 (9007) and AlmaLinux 10 (9008)"

OK=0; SKIPPED=0; FAILED=0; CONFLICTS=""
for i in "${!VMIDS[@]}"; do
  VMID=${VMIDS[$i]}; NAME=${NAMES[$i]}; IMG=$DIR/${IMGS[$i]}

  if [ $HAS_AVX2 -eq 0 ] && { [ "$VMID" = 9007 ] || [ "$VMID" = 9008 ]; }; then
    SKIPPED=$((SKIPPED+1)); continue
  fi
  if [ ! -f "$IMG" ]; then
    echo "FAIL [$VMID] $NAME: image missing: $IMG"; FAILED=$((FAILED+1)); continue
  fi
  if qm status "$VMID" &>/dev/null || pct status "$VMID" &>/dev/null; then
    # VMID taken: fine if it's already our template, a conflict otherwise
    if qm config "$VMID" 2>/dev/null | grep -q "^name: $NAME"; then
      echo "OK   [$VMID] $NAME: already present — skipping"
      OK=$((OK+1))
    else
      echo "CONFLICT [$VMID]: VMID in use by something else — resolve manually!"
      CONFLICTS="$CONFLICTS $VMID"; FAILED=$((FAILED+1))
    fi
    continue
  fi

  echo "=== [$VMID] $NAME ==="
  qm create "$VMID" --name "$NAME" --ostype l26 --memory 2048 --cores 2 --cpu host \
    --net0 virtio,bridge=vmbr0,firewall=1 --scsihw virtio-scsi-single \
    --agent enabled=1 --serial0 socket \
  && qm importdisk "$VMID" "$IMG" local --format raw >/dev/null \
  && qm set "$VMID" --scsi0 "local:$VMID/vm-$VMID-disk-0.raw,discard=on" \
  && qm set "$VMID" --boot order=scsi0 \
  && qm set "$VMID" --ciuser root \
  && qm template "$VMID"
  if [ $? -eq 0 ]; then
    echo "OK   [$VMID] $NAME"; OK=$((OK+1))
  else
    echo "FAIL [$VMID] $NAME"; FAILED=$((FAILED+1))
    qm destroy "$VMID" &>/dev/null   # don't leave half-built VMs behind
  fi
done

echo "----------------------------------------"
echo "RESULT $(hostname): $OK ok, $SKIPPED skipped (no AVX2), $FAILED failed${CONFLICTS:+ — VMID conflicts:$CONFLICTS}"
[ $FAILED -eq 0 ] || exit 1
