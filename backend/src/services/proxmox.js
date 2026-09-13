/**
 * Proxmox VE REST API client
 *
 * Node object (from DB) requires:
 *   hostname        - Proxmox host IP or domain
 *   port            - API port (default 8006)
 *   api_token_id    - e.g.  root@pam!zenith
 *   api_token_secret- the UUID token secret
 *   proxmox_node    - PVE node name (e.g. pve)
 *   storage         - default storage for VM disks (e.g. local-lvm)
 */

import { Agent, fetch } from 'undici';

// Reusable agent that skips self-signed cert verification (standard on Proxmox)
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });

// ─── Core request ────────────────────────────────────────────────────────────

async function req(node, method, path, body = null) {
  const base = `https://${node.hostname}:${node.port || 8006}`;
  const url  = `${base}/api2/json${path}`;

  const headers = {
    Authorization: `PVEAPIToken=${node.api_token_id}=${node.api_token_secret}`,
  };

  const opts = { method, headers, dispatcher: insecureAgent };

  if (body && (method === 'POST' || method === 'PUT')) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(flattenBody(body)).toString();
  }

  const response = await fetch(url, opts);
  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Proxmox ${method} ${path} → ${response.status}: ${text}`);
  }

  try {
    const json = JSON.parse(text);
    return json.data !== undefined ? json.data : json;
  } catch {
    return text;
  }
}

// Proxmox doesn't accept nested objects — flatten arrays to comma strings
function flattenBody(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    out[k] = Array.isArray(v) ? v.join(',') : String(v);
  }
  return out;
}

// ─── Wait for Proxmox task to finish ─────────────────────────────────────────

export async function waitForTask(node, upid, timeoutMs = 120000) {
  const start = Date.now();
  const pveNode = node.proxmox_node || 'pve';
  const encodedUpid = encodeURIComponent(upid);

  while (Date.now() - start < timeoutMs) {
    const status = await req(node, 'GET', `/nodes/${pveNode}/tasks/${encodedUpid}/status`);
    if (status.status === 'stopped') {
      if (status.exitstatus !== 'OK' && !status.exitstatus?.startsWith('WARNINGS:')) {
        throw new Error(`Proxmox task failed: ${status.exitstatus}`);
      }
      return status;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Proxmox task timed out');
}

export async function waitForGuestAgent(node, vmid, timeoutMs = 300000) {
  const pveNode = node.proxmox_node || 'pve';
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await req(node, 'GET', `/nodes/${pveNode}/qemu/${vmid}/agent/info`);
      return true;
    } catch {
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  throw new Error('Guest agent timed out');
}

// Set a user's password inside the guest via the QEMU agent — used for Windows,
// where it's more reliable than cloud-init/cloudbase password injection alone.
export async function setGuestUserPassword(node, vmid, username, password) {
  const pveNode = node.proxmox_node || 'pve';
  return req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/agent/set-user-password`, { username, password });
}

export async function runGuestExec(node, vmid, command) {
  const pveNode = node.proxmox_node || 'pve';
  const base = `https://${node.hostname}:${node.port || 8006}`;
  const url = `${base}/api2/json/nodes/${pveNode}/qemu/${vmid}/agent/exec`;

  // Proxmox requires array elements as repeated 'command' keys, not comma-joined
  const params = new URLSearchParams();
  const args = Array.isArray(command) ? command : [command];
  args.forEach(a => params.append('command', a));

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `PVEAPIToken=${node.api_token_id}=${node.api_token_secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
    dispatcher: insecureAgent,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Guest exec failed: ${text}`);
  const pid = JSON.parse(text)?.data?.pid;
  if (!pid) return;

  // Poll up to 10 minutes for the command to finish
  for (let i = 0; i < 120; i++) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const status = await req(node, 'GET', `/nodes/${pveNode}/qemu/${vmid}/agent/exec-status?pid=${pid}`);
      if (status.exited) return status;
    } catch {}
  }
}

// ─── Node info ───────────────────────────────────────────────────────────────

export async function testConnection(node) {
  const pveNode = node.proxmox_node || 'pve';
  const data = await req(node, 'GET', `/nodes/${pveNode}/status`);
  return !!data;
}

export async function getNodeStats(node) {
  const pveNode = node.proxmox_node || 'pve';
  const data = await req(node, 'GET', `/nodes/${pveNode}/status`);
  return {
    cpu_used:  Math.round((data.cpu || 0) * 100),
    ram_used:  Math.round((data.memory?.used  || 0) / 1024 / 1024),
    ram_total: Math.round((data.memory?.total || 0) / 1024 / 1024),
    disk_used: Math.round((data.rootfs?.used  || 0) / 1024 / 1024 / 1024),
    disk_total:Math.round((data.rootfs?.total || 0) / 1024 / 1024 / 1024),
    uptime:    data.uptime || 0,
  };
}

// ─── VMID helpers ─────────────────────────────────────────────────────────────

export async function getNextVmid(node) {
  const data = await req(node, 'GET', '/cluster/nextid');
  return parseInt(data);
}

// ─── LXC Template library ────────────────────────────────────────────────────

export async function listAvailableLxcTemplates(node) {
  const pveNode = node.proxmox_node || 'pve';
  return req(node, 'GET', `/nodes/${pveNode}/aplinfo`);
}

export async function downloadLxcTemplate(node, storage, template) {
  const pveNode = node.proxmox_node || 'pve';
  return req(node, 'POST', `/nodes/${pveNode}/aplinfo/download`, { storage, template });
}

export async function listStorageTemplates(node, storage) {
  const pveNode = node.proxmox_node || 'pve';
  const items = await req(node, 'GET', `/nodes/${pveNode}/storage/${storage}/content`);
  return items.filter(i => i.content === 'vztmpl' || i.content === 'images');
}

// ─── Per-plan resource ceilings ──────────────────────────────────────────────

/**
 * Build the Proxmox disk-throttle suffix for a KVM guest from its plan.
 *
 * A guest with no ceiling can pin a whole node's spindles and starve every other
 * tenant on it — the failure mode is entirely external to the guest, so the guest
 * has no reason to stop. iops_rd/iops_wr cap the sustained rate; the *_max burst
 * allowance is set to 2x so ordinary bursty work (a package install, a backup) is
 * not punished while a sustained hammer is.
 *
 * Returns '' when the plan sets no ceiling, so existing plans are unchanged.
 */
export function kvmThrottleSuffix(plan) {
  if (!plan) return '';
  const rd = parseInt(plan.max_iops_read)  || 0;
  const wr = parseInt(plan.max_iops_write) || 0;
  const parts = [];
  if (rd > 0) parts.push(`iops_rd=${rd}`, `iops_rd_max=${rd * 2}`, 'iops_rd_max_length=30');
  if (wr > 0) parts.push(`iops_wr=${wr}`, `iops_wr_max=${wr * 2}`, 'iops_wr_max_length=30');
  return parts.length ? ',' + parts.join(',') : '';
}

/**
 * Apply a plan's ceilings to an existing guest.
 *
 * KVM throttling goes through the Proxmox API and takes effect without a reboot.
 * LXC is the gap: the container API exposes only cpulimit/cpuunits — there is no
 * pids or io option — so a container's task and IOPS ceilings have to be written
 * to its cgroup on the node itself. scripts/apply-lxc-limits.sh does that; this
 * function applies what the API *can* reach and reports the rest as unenforced so
 * callers never assume a limit is live when it is not.
 */
export async function applyPlanLimits(node, vmid, type, plan) {
  const pveNode = node.proxmox_node || 'pve';
  const applied = [];
  const unenforced = [];
  if (!plan) return { applied, unenforced };

  const units = parseInt(plan.cpu_units) || 0;
  const rd    = parseInt(plan.max_iops_read)  || 0;
  const wr    = parseInt(plan.max_iops_write) || 0;
  const pids  = parseInt(plan.max_pids) || 0;

  if (type === 'kvm') {
    if (rd > 0 || wr > 0) {
      const cfg = await req(node, 'GET', `/nodes/${pveNode}/qemu/${vmid}/config`);
      const disk = String(cfg.scsi0 || '');
      if (disk) {
        // Strip any throttle keys already on the disk, then re-apply from the plan.
        const base = disk.split(',').filter(k => !/^(iops|mbps|bps)(_|=)/.test(k)).join(',');
        await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, {
          scsi0: base + kvmThrottleSuffix(plan),
        });
        applied.push(`iops_rd=${rd || 'unset'}`, `iops_wr=${wr || 'unset'}`);
      }
    }
    if (units > 0) {
      await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, { cpuunits: units });
      applied.push(`cpuunits=${units}`);
    }
    if (pids > 0) unenforced.push('max_pids (KVM guests have their own kernel; pids ceilings apply to LXC only)');
    return { applied, unenforced };
  }

  // LXC
  if (units > 0) {
    await req(node, 'PUT', `/nodes/${pveNode}/lxc/${vmid}/config`, { cpuunits: units });
    applied.push(`cpuunits=${units}`);
  }
  if (pids > 0) unenforced.push(`max_pids=${pids} (needs scripts/apply-lxc-limits.sh on ${node.hostname})`);
  if (rd > 0 || wr > 0) unenforced.push(`iops ceilings (needs scripts/apply-lxc-limits.sh on ${node.hostname})`);
  return { applied, unenforced };
}

// ─── Pre-flight template checks ──────────────────────────────────────────────

/**
 * Verify that a panel template row actually exists on the target node.
 *
 * Templates are per-node artifacts — a KVM template is a VMID that has to have been
 * shipped to that node, an LXC template is a tarball in that node's own storage — but
 * the panel's templates table is global. Nothing stopped us offering a template on a
 * node that never received it; the clone then failed deep inside the worker, after the
 * VPS row already existed and the customer was looking at "creating".
 *
 * Resolves to { ok: true } or { ok: false, code, error }. Throws only when the node API
 * itself cannot be reached — callers should use templatePreflight() to fold that in.
 */
export async function verifyTemplateOnNode(node, tpl) {
  const pveNode = node.proxmox_node || 'pve';
  const shipScript = String(tpl.os_family || '').toLowerCase() === 'windows'
    ? 'ship-windows-templates.sh'
    : 'ship-templates.sh';

  if (tpl.type === 'kvm') {
    const ref = String(tpl.proxmox_template_id ?? '').trim();
    if (!/^\d+$/.test(ref)) {
      return {
        ok: false,
        code: 'template_unconfigured',
        error: `Template "${tpl.name}" has no Proxmox VMID set — set one on the Templates page.`,
      };
    }
    const vms = await req(node, 'GET', `/nodes/${pveNode}/qemu`);
    if (!(vms || []).some(v => String(v.vmid) === ref)) {
      return {
        ok: false,
        code: 'template_missing',
        error: `Template "${tpl.name}" (VMID ${ref}) is not on node "${node.name}". Ship it first — on Slave 62: /root/kvm-templates/${shipScript} ${node.hostname}`,
      };
    }
    return { ok: true };
  }

  // LXC: the ref is a storage volid, e.g. local:vztmpl/ubuntu-22.04-ssh-enabled.tar.zst
  const volid = String(tpl.path || tpl.proxmox_template_id || '').trim();
  if (!volid.includes(':')) {
    return {
      ok: false,
      code: 'template_unconfigured',
      error: `Template "${tpl.name}" has no storage volid set — set one on the Templates page.`,
    };
  }
  const items = await req(node, 'GET', `/nodes/${pveNode}/storage/${volid.split(':')[0]}/content`);
  if (!(items || []).some(i => i.volid === volid)) {
    return {
      ok: false,
      code: 'template_missing',
      error: `Template "${tpl.name}" (${volid}) is not on node "${node.name}". Ship it first — on Slave 62: /root/kvm-templates/${shipScript} ${node.hostname}`,
    };
  }
  return { ok: true };
}

/**
 * verifyTemplateOnNode() with node-unreachable folded into the result. A node we cannot
 * reach cannot provision either, so this is still a hard "no" — just a different code so
 * callers can answer 503 rather than 422.
 */
export async function templatePreflight(node, tpl) {
  try {
    return await verifyTemplateOnNode(node, tpl);
  } catch (e) {
    return {
      ok: false,
      code: 'node_unreachable',
      error: `Could not reach node "${node.name}" to verify template "${tpl.name}": ${e.message}`,
    };
  }
}

// ─── QEMU (KVM) VM operations ────────────────────────────────────────────────

export async function createKvmVm(node, { vmid, templateVmid, hostname, cpus, ram, diskSize, ipConfig, password, macAddress, additionalIpConfigs = [], plan = null }) {
  const pveNode = node.proxmox_node || 'pve';
  const storage = node.storage || 'local-lvm';

  // Clone template
  const cloneTask = await req(node, 'POST', `/nodes/${pveNode}/qemu/${templateVmid}/clone`, {
    newid:   vmid,
    name:    hostname,
    storage: storage,
    full:    1,
  });
  await waitForTask(node, cloneTask);

  // Resize disk if needed
  if (diskSize) {
    await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/resize`, {
      disk: 'scsi0',
      size: `${diskSize}G`,
    });
  }

  // Per-plan disk throttle, applied to the cloned disk before first boot so the
  // guest can never exceed its tier's IOPS even during its own provisioning.
  const throttle = kvmThrottleSuffix(plan);
  if (throttle) {
    const cfg  = await req(node, 'GET', `/nodes/${pveNode}/qemu/${vmid}/config`);
    const disk = String(cfg.scsi0 || '');
    if (disk) {
      const base = disk.split(',').filter(k => !/^(iops|mbps|bps)(_|=)/.test(k)).join(',');
      await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, { scsi0: base + throttle });
    }
  }

  // Add cloud-init drive and configure (works for both Linux cloud-init and Windows cloudbase-init).
  // This carries the IP, password and DNS — retry transient API errors and throw if it ultimately
  // fails, so a hiccup marks the job failed rather than silently leaving a VM with no network or
  // password (which then looks "running" but is unreachable by SSH and console).
  const ciConfig = {
    cores:    cpus,
    memory:   ram,
    ide3:     `${storage}:cloudinit`,
    cipassword: password,
    ipconfig0: ipConfig || 'ip=dhcp',
    nameserver: '8.8.8.8',
    searchdomain: 'localdomain',
  };
  // Providers like OneProvider require a specific MAC per IP; Leaseweb-style pools
  // leave macAddress empty and keep the random MAC generated on clone.
  if (macAddress) ciConfig.net0 = `virtio=${macAddress},bridge=vmbr0,firewall=1`;
  // Extra IPs get their own NIC + cloud-init slot (net1/ipconfig1, net2/ipconfig2, …).
  // Only net0 carries the gateway — a second default route would break routing.
  Object.assign(ciConfig, kvmAdditionalNetConfig(additionalIpConfigs));
  let ciApplied = false;
  for (let attempt = 1; attempt <= 3 && !ciApplied; attempt++) {
    try {
      await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, ciConfig);
      ciApplied = true;
    } catch (e) {
      if (attempt === 3) throw new Error(`cloud-init config failed for vmid ${vmid} after 3 attempts: ${e.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/cloudinit`).catch(() => {});

  // Start VM
  const startTask = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/start`);
  await waitForTask(node, startTask);

  return vmid;
}

export async function deleteKvmVm(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/stop`).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  let task;
  try {
    task = await req(node, 'DELETE', `/nodes/${pveNode}/qemu/${vmid}`, { purge: 1 });
  } catch (err) {
    if (err.message.includes('does not exist') || err.message.includes('404')) return;
    throw err;
  }
  await waitForTask(node, task);
}

export async function startKvmVm(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const task = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/start`);
  await waitForTask(node, task);
}

export async function stopKvmVm(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const task = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/shutdown`);
  await waitForTask(node, task);
}

export async function forceStopKvmVm(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const task = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/stop`);
  await waitForTask(node, task);
}

export async function restartKvmVm(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const task = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/reboot`);
  await waitForTask(node, task);
}

export async function suspendKvmVm(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  // Proxmox suspend = pause (RAM intact). For billing suspend, we stop the VM.
  const task = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/stop`);
  await waitForTask(node, task);
}

export async function unsuspendKvmVm(node, vmid) {
  return startKvmVm(node, vmid);
}

export async function getKvmVmStatus(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const data = await req(node, 'GET', `/nodes/${pveNode}/qemu/${vmid}/status/current`);
  return mapStatus(data.status);
}

export async function getKvmVmStats(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const data = await req(node, 'GET', `/nodes/${pveNode}/qemu/${vmid}/status/current`);
  return {
    cpu:    Math.round((data.cpu || 0) * 100),
    ram:    Math.round((data.mem  || 0) / 1024 / 1024),
    netin:  data.netin  || 0,
    netout: data.netout || 0,
    diskreads: data.diskread  || 0,
    diskwrites: data.diskwrite || 0,
  };
}

export async function getKvmVncProxy(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const data = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/vncproxy`, { websocket: 1 });
  return {
    host:    node.hostname,
    port:    node.port || 8006,
    vncPort: data.port,
    path:    `/api2/json/nodes/${pveNode}/qemu/${vmid}/vncwebsocket`,
    ticket:  data.ticket,
    vmid,
  };
}

// ─── LXC Container operations ────────────────────────────────────────────────

// additionalIpConfigs entries: either a plain 'ip=x.x.x.x/nn' string, or { ipConfig, mac }
function lxcNetSpec(ethIndex, ipConf, mac) {
  return `name=eth${ethIndex},bridge=vmbr0,${ipConf}${mac ? `,hwaddr=${mac}` : ''},firewall=1`;
}

export async function createLxcContainer(node, { vmid, templatePath, hostname, cpus, ram, diskSize, password, storage, ipConfig, macAddress, additionalIpConfigs = [], plan = null }) {
  const pveNode = node.proxmox_node || 'pve';
  const st = storage || node.storage || 'local';
  const netIp = ipConfig || 'ip=dhcp';

  const body = {
    vmid,
    ostemplate: templatePath,
    hostname,
    cores:       cpus,
    memory:      ram,
    swap:        512,
    rootfs:      `${st}:${diskSize || 20}`,
    password,
    net0:        lxcNetSpec(0, netIp, macAddress),
    start:       0,
    unprivileged: 1,
  };

  // cpuunits is the only per-plan ceiling the LXC API accepts; pids and IOPS
  // ceilings live in the container's cgroup and are applied on the node by
  // scripts/apply-lxc-limits.sh.
  const lxcUnits = parseInt(plan?.cpu_units) || 0;
  if (lxcUnits > 0) body.cpuunits = lxcUnits;

  additionalIpConfigs.forEach((entry, i) => {
    const conf = typeof entry === 'string' ? { ipConfig: entry } : entry;
    body[`net${i + 1}`] = lxcNetSpec(i + 1, conf.ipConfig, conf.mac);
  });

  const task = await req(node, 'POST', `/nodes/${pveNode}/lxc`, body);
  await waitForTask(node, task);
  return vmid;
}

// ─── Firewall ────────────────────────────────────────────────────────────────

export async function getFirewallRules(node, vmid, type = 'lxc') {
  const pveNode = node.proxmox_node || 'pve';
  const path = type === 'lxc' ? `lxc` : `qemu`;
  return req(node, 'GET', `/nodes/${pveNode}/${path}/${vmid}/firewall/rules`);
}

export async function addFirewallRule(node, vmid, rule, type = 'lxc') {
  const pveNode = node.proxmox_node || 'pve';
  const path = type === 'lxc' ? `lxc` : `qemu`;
  return req(node, 'POST', `/nodes/${pveNode}/${path}/${vmid}/firewall/rules`, rule);
}

export async function updateFirewallRule(node, vmid, pos, rule, type = 'lxc') {
  const pveNode = node.proxmox_node || 'pve';
  const path = type === 'lxc' ? `lxc` : `qemu`;
  return req(node, 'PUT', `/nodes/${pveNode}/${path}/${vmid}/firewall/rules/${pos}`, rule);
}

export async function deleteFirewallRule(node, vmid, pos, type = 'lxc') {
  const pveNode = node.proxmox_node || 'pve';
  const path = type === 'lxc' ? `lxc` : `qemu`;
  return req(node, 'DELETE', `/nodes/${pveNode}/${path}/${vmid}/firewall/rules/${pos}`);
}

export async function getFirewallOptions(node, vmid, type = 'lxc') {
  const pveNode = node.proxmox_node || 'pve';
  const path = type === 'lxc' ? `lxc` : `qemu`;
  return req(node, 'GET', `/nodes/${pveNode}/${path}/${vmid}/firewall/options`);
}

export async function setFirewallOptions(node, vmid, options, type = 'lxc') {
  const pveNode = node.proxmox_node || 'pve';
  const path = type === 'lxc' ? `lxc` : `qemu`;
  return req(node, 'PUT', `/nodes/${pveNode}/${path}/${vmid}/firewall/options`, options);
}

export async function getContainerConfig(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  return req(node, 'GET', `/nodes/${pveNode}/lxc/${vmid}/config`);
}

export async function enableContainerFirewall(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  try {
    await req(node, 'PUT', `/nodes/${pveNode}/lxc/${vmid}/firewall/options`, {
      enable: 1, policy_in: 'ACCEPT', policy_out: 'ACCEPT'
    });
  } catch {}
}

export async function createRescueContainer(node, { rescueVmid, rescueTemplate, hostname, ipConfig, macAddress, additionalIpConfigs = [], password, originalDiskPath, storage }) {
  const pveNode = node.proxmox_node || 'pve';
  const netIp = ipConfig || 'ip=dhcp';
  const st = storage || node.storage || 'local';

  const body = {
    vmid:        rescueVmid,
    ostemplate:  rescueTemplate,
    hostname:    `rescue-${hostname}`,
    cores:       1,
    memory:      512,
    swap:        256,
    rootfs:      `${st}:4`,
    password,
    net0:        lxcNetSpec(0, netIp, macAddress),
    start:       0,
    unprivileged: 1,
  };

  if (originalDiskPath) {
    body.mp0 = `${originalDiskPath},mp=/mnt/original`;
  }

  additionalIpConfigs.forEach((entry, i) => {
    const conf = typeof entry === 'string' ? { ipConfig: entry } : entry;
    body[`net${i + 1}`] = lxcNetSpec(i + 1, conf.ipConfig, conf.mac);
  });

  const task = await req(node, 'POST', `/nodes/${pveNode}/lxc`, body);
  await waitForTask(node, task);
  return rescueVmid;
}

// KVM rescue: boot the VM from a SystemRescue ISO with the original disk still
// attached (visible as /dev/sda inside the rescue system). Console-based access —
// unlike LXC rescue there is no separate container or SSH password.
export async function enableKvmRescue(node, vmid, isoVolid) {
  const pveNode = node.proxmox_node || 'pve';
  const stopTask = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/stop`).catch(() => null);
  if (stopTask) await waitForTask(node, stopTask).catch(() => {});
  // Attach the ISO first, THEN set boot order in a separate call — if both go in one
  // request, Proxmox validates the boot order before ide2 exists and reorders it to
  // put the disk first, so the VM boots the original OS instead of the rescue system.
  await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, { ide2: `${isoVolid},media=cdrom` });
  await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, { boot: 'order=ide2;scsi0' });
  const task = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/start`);
  await waitForTask(node, task);
}

export async function disableKvmRescue(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const stopTask = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/stop`).catch(() => null);
  if (stopTask) await waitForTask(node, stopTask).catch(() => {});
  await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, { boot: 'order=scsi0' });
  await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, { delete: 'ide2' });
  const task = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/start`);
  await waitForTask(node, task);
}

// Rename a guest. KVM keeps the display name in `name`; LXC uses `hostname`, which is
// both the Proxmox label and the container's own hostname.
export async function renameGuest(node, vmid, type, name) {
  const pveNode = node.proxmox_node || 'pve';
  const endpoint = type === 'lxc' ? 'lxc' : 'qemu';
  const body = type === 'lxc' ? { hostname: name } : { name };
  await req(node, 'PUT', `/nodes/${pveNode}/${endpoint}/${vmid}/config`, body);
}

export async function updateLxcConfig(node, vmid, config) {
  const pveNode = node.proxmox_node || 'pve';
  await req(node, 'PUT', `/nodes/${pveNode}/lxc/${vmid}/config`, config);
}

export async function deleteLxcContainer(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/status/stop`).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  let task;
  try {
    task = await req(node, 'DELETE', `/nodes/${pveNode}/lxc/${vmid}`);
  } catch (err) {
    if (err.message.includes('does not exist') || err.message.includes('404')) return;
    throw err;
  }
  await waitForTask(node, task);
}

export async function startLxcContainer(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const task = await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/status/start`);
  await waitForTask(node, task);
}

export async function stopLxcContainer(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const task = await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/status/shutdown`);
  await waitForTask(node, task);
}

export async function forceStopLxcContainer(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const task = await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/status/stop`);
  await waitForTask(node, task);
}

export async function restartLxcContainer(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const task = await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/status/reboot`);
  await waitForTask(node, task);
}

export async function getLxcContainerStatus(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const data = await req(node, 'GET', `/nodes/${pveNode}/lxc/${vmid}/status/current`);
  return mapStatus(data.status);
}

export async function getLxcContainerStats(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const data = await req(node, 'GET', `/nodes/${pveNode}/lxc/${vmid}/status/current`);
  return {
    cpu:    Math.round((data.cpu || 0) * 100),
    ram:    Math.round((data.mem  || 0) / 1024 / 1024),
    netin:  data.netin  || 0,
    netout: data.netout || 0,
    diskreads: data.diskread  || 0,
    diskwrites: data.diskwrite || 0,
  };
}

export async function getLxcVncProxy(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  const data = await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/vncproxy`, { websocket: 1 });
  return {
    host:    node.hostname,
    port:    node.port || 8006,
    vncPort: data.port,
    path:    `/api2/json/nodes/${pveNode}/lxc/${vmid}/vncwebsocket`,
    ticket:  data.ticket,
    vmid,
  };
}

// ─── Network reconfiguration ─────────────────────────────────────────────────

// Build net1/ipconfig1, net2/ipconfig2, … for a KVM VM's additional IPs.
// additionalIpConfigs: [{ ipConfig: 'ip=1.2.3.4/24', mac: 'AA:BB:…' | null }]
function kvmAdditionalNetConfig(additionalIpConfigs = []) {
  const cfg = {};
  additionalIpConfigs.forEach((extra, i) => {
    const idx = i + 1;
    cfg[`net${idx}`] = `virtio${extra.mac ? '=' + extra.mac : ''},bridge=vmbr0,firewall=1`;
    cfg[`ipconfig${idx}`] = extra.ipConfig;
  });
  return cfg;
}

export async function reconfigureKvmNetwork(node, vmid, ipConfig, macAddress, additionalIpConfigs = []) {
  const pveNode = node.proxmox_node || 'pve';
  const cfg = { ipconfig0: ipConfig, ...kvmAdditionalNetConfig(additionalIpConfigs) };
  if (macAddress) cfg.net0 = `virtio=${macAddress},bridge=vmbr0,firewall=1`;

  // Drop NIC/ipconfig slots left over from a previous, longer IP list
  const current = await req(node, 'GET', `/nodes/${pveNode}/qemu/${vmid}/config`).catch(() => ({}));
  const stale = Object.keys(current)
    .filter(k => /^(net|ipconfig)\d+$/.test(k))
    .filter(k => parseInt(k.replace(/\D+/g, ''), 10) > additionalIpConfigs.length);
  if (stale.length) {
    await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, { delete: stale.join(',') }).catch(() => {});
  }

  await req(node, 'PUT', `/nodes/${pveNode}/qemu/${vmid}/config`, cfg);
  // Regenerate cloud-init image with new config
  await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/cloudinit`).catch(() => {});
  const task = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/reboot`);
  await waitForTask(node, task);
}

export async function reconfigureLxcNetwork(node, vmid, ipConfig, macAddress) {
  const pveNode = node.proxmox_node || 'pve';
  await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/status/stop`).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  await req(node, 'PUT', `/nodes/${pveNode}/lxc/${vmid}/config`, {
    net0: lxcNetSpec(0, ipConfig, macAddress),
  });
  const task = await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/status/start`);
  await waitForTask(node, task);
}

// ─── Backup (vzdump) ─────────────────────────────────────────────────────────

export async function createBackup(node, vmid, type, storage) {
  const pveNode = node.proxmox_node || 'pve';
  const st = storage || node.backup_storage || node.storage || 'local';

  const task = await req(node, 'POST', `/nodes/${pveNode}/vzdump`, {
    vmid,
    storage: st,
    mode:    'snapshot',
    compress:'zstd',
  });
  await waitForTask(node, task, 600000); // 10 min timeout for backups
  return task;
}

export async function restoreBackup(node, vmid, backupFile, type, storage) {
  const pveNode = node.proxmox_node || 'pve';
  const st = storage || node.storage || 'local-lvm';

  let task;
  if (type === 'lxc') {
    task = await req(node, 'POST', `/nodes/${pveNode}/lxc`, {
      vmid,
      ostemplate: backupFile,
      storage:    st,
      restore:    1,
      start:      1,
    });
  } else {
    task = await req(node, 'POST', `/nodes/${pveNode}/qemu`, {
      vmid,
      archive: backupFile,
      storage: st,
    });
    if (task) await waitForTask(node, task, 600000);
    await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/start`);
    return;
  }
  await waitForTask(node, task, 600000);
}

// ─── Reinstall (restore to template) ─────────────────────────────────────────

export async function reinstallVm(node, vmid, type, templateRef, hostname, password, cpus, ram, diskSize, ipConfig, additionalIpConfigs, macAddress) {
  if (type === 'kvm') {
    await deleteKvmVm(node, vmid);
    await createKvmVm(node, { vmid, templateVmid: templateRef, hostname, cpus, ram, diskSize, ipConfig, password, macAddress, additionalIpConfigs: additionalIpConfigs || [] });
  } else {
    await deleteLxcContainer(node, vmid);
    await createLxcContainer(node, { vmid, templatePath: templateRef, hostname, cpus, ram, diskSize, password, storage: node.storage, ipConfig, macAddress, additionalIpConfigs: additionalIpConfigs || [] });
    if (ipConfig && ipConfig !== 'ip=dhcp') {
      const ip = ipConfig.split('/')[0].replace('ip=', '');
      await updateLxcConfig(node, vmid, { hostname: ip });
    }
    await startLxcContainer(node, vmid);
  }
}

// ─── Status normalizer ────────────────────────────────────────────────────────

function mapStatus(proxmoxStatus) {
  const map = {
    running:  'running',
    stopped:  'stopped',
    paused:   'stopped',
    suspended:'stopped',
  };
  return map[proxmoxStatus] || 'unknown';
}
