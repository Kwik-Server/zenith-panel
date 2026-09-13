#!/bin/bash
# apply-lxc-limits.sh — run ON a Proxmox node.
#
# Applies per-plan task (pids) and disk-IOPS ceilings to LXC containers.
#
# Why this exists: the Proxmox LXC API exposes only cpulimit and cpuunits. There is
# no pids option and no IO option, so the panel cannot enforce those tiers remotely
# the way it does for KVM (where iops_rd/iops_wr are ordinary disk parameters). The
# ceilings live in the container's cgroup v2 controllers and have to be written on
# the node itself.
#
# Usage:
#   ./apply-lxc-limits.sh <vmid> --pids N [--riops N] [--wiops N]   apply to one container
#   ./apply-lxc-limits.sh <vmid> --show                             show current ceilings
#   ./apply-lxc-limits.sh <vmid> --clear                            remove all ceilings
#
# Live values take effect immediately; they are also written to /etc/pve/lxc/<vmid>.conf
# as lxc.cgroup2.* so they survive a container restart and a node reboot.
#
# IMPORTANT — read before setting --pids:
#   pids.current counts THREADS, not processes. A container running a threaded
#   service (PowerMTA, MySQL, a JVM) can legitimately sit at several thousand.
#   Run --show first and set the ceiling above the steady-state figure it reports,
#   or you will not throttle a fork storm — you will kill the customer's database.
#
# IOPS ceilings are applied with blk-throttle (io.max) against the PHYSICAL devices
# backing the storage, because blk-throttle attaches to a real request queue. On md
# RAID the script resolves the members and throttles each; verify with --show that
# the limits are actually biting before relying on them.
set -euo pipefail

VMID=${1:-}
[ -n "$VMID" ] || { sed -n '2,30p' "$0" | sed 's/^# \?//'; exit 1; }
shift

CG=/sys/fs/cgroup/lxc/$VMID
CONF=/etc/pve/lxc/$VMID.conf

[ -d "$CG" ]    || { echo "FATAL: $CG not found — is container $VMID running?"; exit 1; }
[ -f "$CONF" ]  || { echo "FATAL: $CONF not found — no such container on this node"; exit 1; }

PIDS=""; RIOPS=""; WIOPS=""; SHOW=0; CLEAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --pids)  PIDS=$2;  shift 2 ;;
    --riops) RIOPS=$2; shift 2 ;;
    --wiops) WIOPS=$2; shift 2 ;;
    --show)  SHOW=1;   shift ;;
    --clear) CLEAR=1;  shift ;;
    *) echo "unknown argument: $1"; exit 1 ;;
  esac
done

# Physical devices behind the container's storage. blk-throttle needs a real request
# queue, so an md array is expanded to its members rather than throttled directly.
backing_devices() {
  root=$(findmnt -no SOURCE / 2>/dev/null || echo "")
  src=$(basename "${root:-}")
  {
    if [ -d "/sys/block/$src/md" ]; then
      # md array: throttle each member, since the array itself has no throttleable queue
      for m in /sys/block/"$src"/md/dev-*; do
        [ -e "$m" ] || continue
        basename "$m" | sed 's/^dev-//'
      done
    else
      echo "$src"
    fi
  } | while read -r part; do
      # Walk a partition up to its whole disk (sda5 -> sda). lsblk prints the parent
      # first and then the device itself, so take only the first line.
      disk=$(lsblk -no PKNAME "/dev/$part" 2>/dev/null | head -1)
      echo "${disk:-$part}"
    done | sort -u | while read -r d; do
      # Only whole disks have a request queue, and blk-throttle attaches to the queue.
      # A partition's major:minor is silently useless here, so drop anything without one.
      [ -d "/sys/block/$d/queue" ] && echo "$d"
    done
}

devnums() {
  for d in $(backing_devices); do
    [ -b "/dev/$d" ] || continue
    printf '%d:%d\n' "$(stat -c '%Hr' "/dev/$d")" "$(stat -c '%Lr' "/dev/$d")"
  done
}

if [ "$SHOW" = 1 ]; then
  echo "=== container $VMID ==="
  echo "pids.current (THREADS): $(cat "$CG/pids.current" 2>/dev/null)"
  echo "pids.peak:              $(cat "$CG/pids.peak"    2>/dev/null || echo n/a)"
  echo "pids.max:               $(cat "$CG/pids.max"     2>/dev/null)"
  echo "io.max:                 [$(cat "$CG/io.max" 2>/dev/null)]"
  echo "cpu.weight:             $(cat "$CG/cpu.weight"   2>/dev/null)"
  echo "memory.current/max:     $(cat "$CG/memory.current" 2>/dev/null) / $(cat "$CG/memory.max" 2>/dev/null)"
  echo "backing devices:        $(backing_devices | tr '\n' ' ') -> $(devnums | tr '\n' ' ')"
  echo
  echo "per-service task counts (set --pids ABOVE the total):"
  find "$CG" -name pids.current 2>/dev/null | sort | while read -r f; do
    n=$(cat "$f" 2>/dev/null); d=${f%/pids.current}
    [ "${n:-0}" -gt 5 ] && echo "  $n  ${d#"$CG"}"
  done | sort -rn | head -15
  exit 0
fi

if [ "$CLEAR" = 1 ]; then
  echo max > "$CG/pids.max"
  for dn in $(devnums); do echo "$dn riops=max wiops=max" > "$CG/io.max"; done
  sed -i '/^lxc\.cgroup2\.\(pids\.max\|io\.max\)/d' "$CONF"
  echo "cleared ceilings for $VMID (live + $CONF)"
  exit 0
fi

[ -n "$PIDS$RIOPS$WIOPS" ] || { echo "nothing to do — pass --pids/--riops/--wiops, or --show"; exit 1; }

if [ -n "$PIDS" ]; then
  CUR=$(cat "$CG/pids.current" 2>/dev/null || echo 0)
  if [ "$PIDS" -le "$CUR" ]; then
    echo "REFUSING: --pids $PIDS is at or below the container's current $CUR THREADS."
    echo "That would refuse new forks immediately and can kill running services."
    echo "Run --show and pick a ceiling above the steady-state figure."
    exit 1
  fi
  echo "$PIDS" > "$CG/pids.max"
  sed -i '/^lxc\.cgroup2\.pids\.max/d' "$CONF"
  echo "lxc.cgroup2.pids.max: $PIDS" >> "$CONF"
  echo "pids.max = $PIDS (was current=$CUR)"
fi

if [ -n "$RIOPS" ] || [ -n "$WIOPS" ]; then
  sed -i '/^lxc\.cgroup2\.io\.max/d' "$CONF"
  for dn in $(devnums); do
    LINE="$dn"
    [ -n "$RIOPS" ] && LINE="$LINE riops=$RIOPS"
    [ -n "$WIOPS" ] && LINE="$LINE wiops=$WIOPS"
    echo "$LINE" > "$CG/io.max"
    echo "lxc.cgroup2.io.max: $LINE" >> "$CONF"
    echo "io.max = $LINE"
  done
  echo
  echo "NOTE: blk-throttle on md members is not guaranteed to capture every IO path."
  echo "Confirm it bites: watch 'cat $CG/io.stat' and /proc/diskstats for a minute."
fi

echo "done — live now, and persisted in $CONF"
