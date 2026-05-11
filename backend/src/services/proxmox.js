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
      if (status.exitstatus !== 'OK') {
        throw new Error(`Proxmox task failed: ${status.exitstatus}`);
      }
      return status;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error('Proxmox task timed out');
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

// ─── QEMU (KVM) VM operations ────────────────────────────────────────────────

export async function createKvmVm(node, { vmid, templateVmid, hostname, cpus, ram, diskSize, ipConfig, password }) {
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

  // Configure CPU/RAM + cloud-init
  const config = {
    cores:    cpus,
    memory:   ram,
    cipasswd: password,
    ipconfig0: ipConfig || 'ip=dhcp',
    nameserver: '8.8.8.8',
    searchdomain: 'localdomain',
  };
  await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/config`, config);

  // Regenerate cloud-init drive
  await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/cloudinit`).catch(() => {});

  // Start VM
  const startTask = await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/start`);
  await waitForTask(node, startTask);

  return vmid;
}

export async function deleteKvmVm(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  // Stop first (ignore errors if already stopped)
  await req(node, 'POST', `/nodes/${pveNode}/qemu/${vmid}/status/stop`).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));
  const task = await req(node, 'DELETE', `/nodes/${pveNode}/qemu/${vmid}`, { purge: 1 });
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

export async function createLxcContainer(node, { vmid, templatePath, hostname, cpus, ram, diskSize, password, storage, ipConfig, additionalIpConfigs = [] }) {
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
    net0:        `name=eth0,bridge=vmbr0,${netIp}`,
    start:       0,
    unprivileged: 1,
  };

  additionalIpConfigs.forEach((ipConf, i) => {
    body[`net${i + 1}`] = `name=eth${i + 1},bridge=vmbr0,${ipConf}`;
  });

  const task = await req(node, 'POST', `/nodes/${pveNode}/lxc`, body);
  await waitForTask(node, task);
  return vmid;
}

export async function updateLxcConfig(node, vmid, config) {
  const pveNode = node.proxmox_node || 'pve';
  await req(node, 'PUT', `/nodes/${pveNode}/lxc/${vmid}/config`, config);
}

export async function deleteLxcContainer(node, vmid) {
  const pveNode = node.proxmox_node || 'pve';
  await req(node, 'POST', `/nodes/${pveNode}/lxc/${vmid}/status/stop`).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));
  const task = await req(node, 'DELETE', `/nodes/${pveNode}/lxc/${vmid}`);
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

export async function reinstallVm(node, vmid, type, templateRef, hostname, password, cpus, ram, diskSize, ipConfig, additionalIpConfigs) {
  if (type === 'kvm') {
    await deleteKvmVm(node, vmid);
    await createKvmVm(node, { vmid, templateVmid: templateRef, hostname, cpus, ram, diskSize, ipConfig, password });
  } else {
    await deleteLxcContainer(node, vmid);
    await createLxcContainer(node, { vmid, templatePath: templateRef, hostname, cpus, ram, diskSize, password, storage: node.storage, ipConfig, additionalIpConfigs: additionalIpConfigs || [] });
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
