import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';
import { addVpsJob } from '../../services/queue.js';
import { logAction } from '../../services/audit.js';
import { v4 as uuidv4 } from 'uuid';
import * as proxmox from '../../services/proxmox.js';

export default async function vpsRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const { page = 1, limit = 20, status, node_id, user_id, search } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (status)  { where += ' AND v.status = ?';  params.push(status); }
    if (node_id) { where += ' AND v.node_id = ?'; params.push(node_id); }
    if (user_id) { where += ' AND v.user_id = ?'; params.push(user_id); }
    if (search) {
      const like = `%${search}%`;
      where += ` AND (v.hostname LIKE ? OR u.email LIKE ?
                      OR EXISTS (SELECT 1 FROM ip_addresses WHERE vps_id = v.id AND ip_address LIKE ?))`;
      params.push(like, like, like);
    }
    const rows = await query(
      `SELECT v.*, u.email as user_email, n.name as node_name, p.name as plan_name,
              t.name as template_name,
              (SELECT ip_address FROM ip_addresses WHERE vps_id = v.id ORDER BY is_primary DESC, assigned_at, id LIMIT 1) as ip_address
       FROM vps v
       JOIN users u ON v.user_id = u.id
       JOIN nodes n ON v.node_id = n.id
       JOIN plans p ON v.plan_id = p.id
       LEFT JOIN templates t ON v.template_id = t.id
       ${where} ORDER BY v.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
      params
    );
    const [{ total }] = await query(
      `SELECT COUNT(*) as total FROM vps v JOIN users u ON v.user_id = u.id ${where}`,
      params
    );
    return reply.send({ success: true, data: { vps: rows, total, page: parseInt(page), limit: parseInt(limit) } });
  });

  fastify.post('/', async (req, reply) => {
    const { hostname, user_id, node_id, plan_id, template_id, root_password, whmcs_service_id, ip_address_ids } = req.body || {};
    if (!hostname || !user_id || !node_id || !plan_id || !template_id || !root_password) {
      return reply.status(400).send({ success: false, error: 'hostname, user_id, node_id, plan_id, template_id, root_password required' });
    }

    const tpl = await queryOne('SELECT * FROM templates WHERE id = ? AND is_active = 1', [template_id]);
    if (!tpl) return reply.status(400).send({ success: false, error: 'Template not found or inactive' });

    const netmaskToCidr = (nm) => nm.split('.').reduce((acc, o) => acc + (parseInt(o) >>> 0).toString(2).split('').filter(b => b === '1').length, 0);

    // Use specified IPs or auto-select first available
    let primaryIp = null;
    let additionalIps = [];

    if (Array.isArray(ip_address_ids) && ip_address_ids.length > 0) {
      const wanted = ip_address_ids.map(id => parseInt(id)).filter(id => Number.isInteger(id));
      const rows = await query(
        `SELECT a.*, p.netmask, p.gateway FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id
         WHERE a.id IN (${wanted.map(() => '?').join(',')}) AND a.vps_id IS NULL AND p.node_id = ?`,
        [...wanted, node_id]
      );
      // MySQL returns IN(...) rows in its own order — re-sort to the order the caller
      // picked them, because the first one becomes the primary (eth0) address.
      const byId = new Map(rows.map(r => [r.id, r]));
      const missing = wanted.filter(id => !byId.has(id));
      if (missing.length) {
        return reply.status(422).send({
          success: false,
          error: `Some selected IPs are no longer free or do not belong to this node (ip ids: ${missing.join(', ')})`,
        });
      }
      const selectedIps = wanted.map(id => byId.get(id));
      primaryIp = selectedIps[0];
      additionalIps = selectedIps.slice(1);
    } else {
      primaryIp = await queryOne(
        `SELECT a.*, p.netmask, p.gateway FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id
         WHERE a.vps_id IS NULL AND p.node_id = ? ORDER BY INET_ATON(a.ip_address) LIMIT 1`,
        [node_id]
      );
      if (!primaryIp) {
        return reply.status(422).send({ success: false, error: 'No free IPs available on this node. Add IPs to the pool or select a different node.' });
      }
    }

    const cidr = primaryIp?.netmask ? netmaskToCidr(primaryIp.netmask) : 24;
    const gw = primaryIp?.gateway || '';
    const ipConfig = primaryIp ? `ip=${primaryIp.ip_address}/${cidr}${gw ? ',gw=' + gw : ''}` : 'ip=dhcp';
    const freeIp = primaryIp;

    const uuid = uuidv4();
    const r = await query(
      'INSERT INTO vps (uuid, hostname, user_id, node_id, plan_id, template_id, type, status, whmcs_service_id) VALUES (?, ?, ?, ?, ?, ?, ?, "creating", ?)',
      [uuid, hostname, user_id, node_id, plan_id, template_id, tpl.type, whmcs_service_id || null]
    );
    const vpsId = r.insertId;

    const task = await query(
      'INSERT INTO tasks (vps_id, user_id, type, status) VALUES (?, ?, "create_vps", "pending")',
      [vpsId, req.user.id]
    );

    const additionalIpConfigs = additionalIps.map(ip => ({
      id:        ip.id,
      ipAddress: ip.ip_address,
      cidr:      ip.netmask ? netmaskToCidr(ip.netmask) : 24,
      mac:       ip.mac_address || null,
    }));

    await addVpsJob('create_vps', {
      vpsId, taskId: task.insertId, root_password,
      ip_address_id:      freeIp?.id || null,
      ip:                 freeIp?.ip_address || null,
      mac:                freeIp?.mac_address || null,
      additional_ip_configs: additionalIpConfigs,
      ipConfig,
    });

    await logAction(req.user.id, 'vps_created', 'vps', vpsId, { hostname }, req.ip);
    return reply.status(202).send({ success: true, message: 'VPS creation queued', data: { vps: { id: vpsId, uuid, status: 'creating' } } });
  });

  fastify.post('/:id/reconfigure-network', async (req, reply) => {
    const vps = await queryOne('SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    if (!vps.proxmox_vmid) return reply.status(422).send({ success: false, error: 'VPS not provisioned on Proxmox' });

    const ips = await query(
      'SELECT a.*, p.netmask, p.gateway FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id WHERE a.vps_id = ? ORDER BY a.is_primary DESC, a.assigned_at, a.id',
      [req.params.id]
    );
    if (!ips.length) return reply.status(422).send({ success: false, error: 'No IPs assigned to this VPS — assign an IP first' });

    const netmaskToCidr = (nm) => nm ? nm.split('.').reduce((acc, o) => acc + (parseInt(o) >>> 0).toString(2).split('').filter(b => b === '1').length, 0) : 24;
    const primary = ips[0];
    const cidr = netmaskToCidr(primary.netmask);
    const gw = primary.gateway || '';
    const ipConfig = `ip=${primary.ip_address}/${cidr}${gw ? ',gw=' + gw : ''}`;
    const additionalIpConfigs = ips.slice(1).map(ip => ({
      ipConfig: `ip=${ip.ip_address}/${netmaskToCidr(ip.netmask)}`,
      mac: ip.mac_address || null,
    }));

    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      if (vps.type === 'kvm') {
        await proxmox.reconfigureKvmNetwork(node, vps.proxmox_vmid, ipConfig, primary.mac_address || null, additionalIpConfigs);
      } else {
        await proxmox.reconfigureLxcNetwork(node, vps.proxmox_vmid, ipConfig, primary.mac_address || null);
      }
    } catch (err) {
      return reply.status(422).send({ success: false, error: err.message });
    }

    await logAction(req.user.id, 'vps_network_reconfigured', 'vps', vps.id, { ipConfig, additional: additionalIpConfigs.map(a => a.ipConfig) }, req.ip);
    return reply.send({ success: true, message: 'Network reconfigured', data: { ipConfig, additionalIpConfigs } });
  });

  // Force-remove from Zenith DB without touching Proxmox — for VMs already deleted on Proxmox
  fastify.delete('/:id/force', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE id = ?', [req.params.id]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    await query('UPDATE ip_addresses SET vps_id = NULL, assigned_at = NULL, is_primary = 0 WHERE vps_id = ?', [vps.id]);
    await query('DELETE FROM tasks WHERE vps_id = ?', [vps.id]);
    await query('DELETE FROM vps WHERE id = ?', [vps.id]);
    await logAction(req.user.id, 'vps_force_deleted', 'vps', vps.id, { hostname: vps.hostname, proxmox_vmid: vps.proxmox_vmid }, req.ip);
    return reply.send({ success: true, message: 'VPS removed from Zenith' });
  });

  fastify.post('/import', async (req, reply) => {
    const { proxmox_vmid, hostname, user_id, node_id, plan_id, ip_address_id, whmcs_service_id, notes } = req.body || {};
    if (!proxmox_vmid || !hostname || !user_id || !node_id || !plan_id) {
      return reply.status(400).send({ success: false, error: 'proxmox_vmid, hostname, user_id, node_id, plan_id required' });
    }

    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [node_id]);
    if (!node) return reply.status(404).send({ success: false, error: 'Node not found' });

    const existing = await queryOne('SELECT id FROM vps WHERE proxmox_vmid = ? AND node_id = ?', [proxmox_vmid, node_id]);
    if (existing) return reply.status(409).send({ success: false, error: `VM ${proxmox_vmid} is already registered in Zenith` });

    let vmStatus = 'stopped';
    let vmType = 'kvm';
    try {
      vmStatus = await proxmox.getKvmVmStatus(node, proxmox_vmid);
      vmType = 'kvm';
    } catch {
      try {
        vmStatus = await proxmox.getLxcContainerStatus(node, proxmox_vmid);
        vmType = 'lxc';
      } catch {
        return reply.status(422).send({ success: false, error: `VM/CT ${proxmox_vmid} not found on selected node` });
      }
    }

    const uuid = uuidv4();
    const r = await query(
      'INSERT INTO vps (uuid, proxmox_vmid, hostname, user_id, node_id, plan_id, template_id, type, status, whmcs_service_id, notes) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)',
      [uuid, proxmox_vmid, hostname, user_id, node_id, plan_id, vmType, vmStatus, whmcs_service_id || null, notes || null]
    );
    const vpsId = r.insertId;

    if (ip_address_id) {
      await query('UPDATE ip_addresses SET vps_id = ?, assigned_at = NOW(), is_primary = 1 WHERE id = ? AND vps_id IS NULL', [vpsId, ip_address_id]);
    }

    await logAction(req.user.id, 'vps_imported', 'vps', vpsId, { hostname, proxmox_vmid }, req.ip);
    return reply.status(201).send({ success: true, message: 'VPS imported', data: { id: vpsId, uuid, status: vmStatus, type: vmType } });
  });

  fastify.get('/:id', async (req, reply) => {
    const vps = await queryOne(
      `SELECT v.*, u.email as user_email, n.name as node_name, n.hostname as node_hostname, p.name as plan_name,
              p.cpu, p.ram, p.disk, p.bandwidth,
              (SELECT JSON_ARRAYAGG(ip_address) FROM ip_addresses WHERE vps_id = v.id) as ip_addresses
       FROM vps v
       JOIN users u ON v.user_id = u.id
       JOIN nodes n ON v.node_id = n.id
       JOIN plans p ON v.plan_id = p.id
       WHERE v.id = ?`, [req.params.id]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    return reply.send({ success: true, data: vps });
  });

  // Proxmox validates guest names as DNS names: dot-separated labels of letters, digits
  // and hyphens, not starting or ending with a hyphen.
  const HOSTNAME_RE = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;

  fastify.put('/:id', async (req, reply) => {
    const { hostname, notes } = req.body || {};
    const vps = await queryOne('SELECT * FROM vps WHERE id = ?', [req.params.id]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });

    const newHostname = (hostname === undefined || hostname === null || String(hostname).trim() === '')
      ? null
      : String(hostname).trim();
    if (newHostname && (newHostname.length > 255 || !HOSTNAME_RE.test(newHostname))) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid hostname — use letters, digits, hyphens and dots (labels cannot start or end with a hyphen)',
      });
    }

    // Rename on Proxmox first: if that fails, leave the DB alone rather than let the two drift
    if (newHostname && newHostname !== vps.hostname && vps.proxmox_vmid) {
      const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
      try {
        await proxmox.renameGuest(node, vps.proxmox_vmid, vps.type, newHostname);
      } catch (err) {
        return reply.status(422).send({ success: false, error: `Proxmox rename failed: ${err.message}` });
      }
    }

    await query('UPDATE vps SET hostname=COALESCE(?,hostname), notes=COALESCE(?,notes) WHERE id=?',
      [newHostname, notes ?? null, req.params.id]);

    if (newHostname && newHostname !== vps.hostname) {
      await logAction(req.user.id, 'vps_hostname_changed', 'vps', vps.id, { from: vps.hostname, to: newHostname }, req.ip);
    }
    return reply.send({
      success: true,
      message: vps.type === 'lxc' && newHostname && newHostname !== vps.hostname
        ? 'Hostname updated — restart the container for it to take effect inside the guest'
        : 'VPS updated',
    });
  });

  fastify.delete('/:id', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE id = ?', [req.params.id]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const task = await query('INSERT INTO tasks (vps_id, user_id, type, status) VALUES (?, ?, "delete_vps", "pending")', [vps.id, req.user.id]);
    await addVpsJob('delete_vps', { vpsId: vps.id, taskId: task.insertId });
    await logAction(req.user.id, 'vps_deleted', 'vps', vps.id, { hostname: vps.hostname }, req.ip);
    return reply.status(202).send({ success: true, message: 'VPS deletion queued' });
  });

  // Power actions
  const powerActions = [
    { path: 'start',      job: 'start_vps',      action: 'vps_started' },
    { path: 'stop',       job: 'stop_vps',        action: 'vps_stopped' },
    { path: 'restart',    job: 'restart_vps',     action: 'vps_restarted' },
    { path: 'forceStop',  job: 'force_stop_vps',  action: 'vps_force_stopped' },
    { path: 'suspend',    job: 'suspend_vps',     action: 'vps_suspended' },
    { path: 'unsuspend',  job: 'unsuspend_vps',   action: 'vps_unsuspended' },
    { path: 'reinstall',  job: 'reinstall_vps',   action: 'vps_reinstalled' },
  ];

  for (const { path, job, action } of powerActions) {
    fastify.post(`/:id/${path}`, async (req, reply) => {
      const vps = await queryOne('SELECT * FROM vps WHERE id = ?', [req.params.id]);
      if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
      const task = await query('INSERT INTO tasks (vps_id, user_id, type, status) VALUES (?, ?, ?, "pending")', [vps.id, req.user.id, job]);
      await addVpsJob(job, { vpsId: vps.id, taskId: task.insertId, ...(req.body || {}) });
      await logAction(req.user.id, action, 'vps', vps.id, null, req.ip);
      return reply.status(202).send({ success: true, message: `${job} queued` });
    });
  }

  // WebSocket VNC proxy — tunnels browser ↔ Proxmox VNC WebSocket
  fastify.get('/:id/console/ws', { websocket: true }, (conn, req) => {
    // @fastify/websocket v8 hands us a SocketStream (real WebSocket at .socket);
    // v10+ hands us the WebSocket directly. Support both.
    const socket = conn.socket || conn;
    return new Promise(async (resolve) => {
      try {
        const vps = await queryOne(
          'SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?',
          [req.params.id]
        );
        if (!vps || !vps.proxmox_vmid) { socket.close(1008, 'VPS not found'); return resolve(); }

        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);

        // Frontend passes the ticket+port from GET /:id/console and uses the same
        // ticket as RFB password — Proxmox requires them to match (see client route).
        let vncData;
        if (req.query.vncticket && req.query.vncport) {
          const pveNode = node.proxmox_node || 'pve';
          vncData = {
            host:    node.hostname,
            port:    node.port || 8006,
            vncPort: req.query.vncport,
            ticket:  req.query.vncticket,
            path:    `/api2/json/nodes/${pveNode}/${vps.type === 'lxc' ? 'lxc' : 'qemu'}/${vps.proxmox_vmid}/vncwebsocket`,
          };
        } else {
          vncData = vps.type === 'lxc'
            ? await proxmox.getLxcVncProxy(node, vps.proxmox_vmid)
            : await proxmox.getKvmVncProxy(node, vps.proxmox_vmid);
        }

        const wsUrl = `wss://${vncData.host}:${vncData.port}${vncData.path}?port=${vncData.vncPort}&vncticket=${encodeURIComponent(vncData.ticket)}`;
        const auth  = `PVEAPIToken=${node.api_token_id}=${node.api_token_secret}`;

        const { default: WS } = await import('ws');
        const upstream = new WS(wsUrl, ['binary'], {
          headers: { Authorization: auth },
          rejectUnauthorized: false,
        });

        // Keep both legs alive through idle proxies (nginx default is 60s)
        const keepalive = setInterval(() => {
          try { socket.ping(); } catch {}
          try { if (upstream.readyState === 1) upstream.ping(); } catch {}
        }, 30000);

        upstream.on('open', () => {
          socket.on('message', (data) => { if (upstream.readyState === 1) upstream.send(data); });
        });
        upstream.on('message', (data) => { try { socket.send(data); } catch {} });
        upstream.on('error',   (err)  => { clearInterval(keepalive); console.error('Proxmox WS:', err.message); try { socket.close(1011); } catch {} resolve(); });
        upstream.on('close',   ()     => { clearInterval(keepalive); try { socket.close(); } catch {} resolve(); });
        socket.on('close',     ()     => { clearInterval(keepalive); upstream.close(); resolve(); });

      } catch (err) {
        console.error('Console WS error:', err.message);
        try { socket.close(1011); } catch {}
        resolve();
      }
    });
  });

  // IP management
  fastify.get('/:id/ips', async (req, reply) => {
    const ips = await query(
      `SELECT i.*, p.name as pool_name, p.gateway, p.netmask
       FROM ip_addresses i JOIN ip_pools p ON i.pool_id = p.id
       WHERE i.vps_id = ?
       ORDER BY i.is_primary DESC, i.assigned_at, i.id`, [req.params.id]
    );
    return reply.send({ success: true, data: ips });
  });

  // Change which assigned IP is the primary (eth0) address.
  // Apply it to the hypervisor afterwards with POST /:id/reconfigure-network.
  fastify.put('/:id/ips/:ipId/primary', async (req, reply) => {
    const ip = await queryOne('SELECT * FROM ip_addresses WHERE id = ? AND vps_id = ?', [req.params.ipId, req.params.id]);
    if (!ip) return reply.status(404).send({ success: false, error: 'IP not found on this VPS' });
    await query('UPDATE ip_addresses SET is_primary = 0 WHERE vps_id = ?', [req.params.id]);
    await query('UPDATE ip_addresses SET is_primary = 1 WHERE id = ?', [req.params.ipId]);
    await logAction(req.user.id, 'vps_primary_ip_changed', 'vps', req.params.id, { ip_address: ip.ip_address }, req.ip);
    return reply.send({ success: true, message: 'Primary IP updated — run Reconfigure Network to apply it to the VPS' });
  });

  fastify.post('/:id/ips', async (req, reply) => {
    const { ip_address_id } = req.body || {};
    if (!ip_address_id) return reply.status(400).send({ success: false, error: 'ip_address_id required' });
    const ip = await queryOne('SELECT * FROM ip_addresses WHERE id = ? AND vps_id IS NULL', [ip_address_id]);
    if (!ip) return reply.status(404).send({ success: false, error: 'IP not found or already assigned' });
    const hasPrimary = await queryOne('SELECT id FROM ip_addresses WHERE vps_id = ? AND is_primary = 1', [req.params.id]);
    await query('UPDATE ip_addresses SET vps_id = ?, assigned_at = NOW(), is_primary = ? WHERE id = ?', [req.params.id, hasPrimary ? 0 : 1, ip_address_id]);
    return reply.send({ success: true });
  });

  fastify.delete('/:id/ips/:ipId', async (req, reply) => {
    const ip = await queryOne('SELECT * FROM ip_addresses WHERE id = ? AND vps_id = ?', [req.params.ipId, req.params.id]);
    if (!ip) return reply.status(404).send({ success: false, error: 'IP not found on this VPS' });
    await query('UPDATE ip_addresses SET vps_id = NULL, assigned_at = NULL, is_primary = 0 WHERE id = ?', [req.params.ipId]);
    // If the primary was removed, promote the oldest remaining IP so the VPS still has one
    if (ip.is_primary) {
      await query(
        `UPDATE ip_addresses SET is_primary = 1
         WHERE id = (SELECT id FROM (SELECT id FROM ip_addresses WHERE vps_id = ? ORDER BY assigned_at, id LIMIT 1) x)`,
        [req.params.id]
      );
    }
    return reply.send({ success: true });
  });

  // rDNS / PTR management via Leaseweb API
  fastify.get('/:id/rdns', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE id = ?', [req.params.id]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const ips = await query(
      'SELECT a.ip_address, p.leaseweb_api_key FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id WHERE a.vps_id = ?',
      [vps.id]
    );
    const { fetch } = await import('undici');
    const results = await Promise.all(ips.map(async (ip) => {
      if (!ip.leaseweb_api_key) return { ip: ip.ip_address, ptr: '', error: 'No Leaseweb API key on this pool' };
      try {
        const res  = await fetch(`https://api.leaseweb.com/ipMgmt/v2/ips/${ip.ip_address}`, { headers: { 'X-LSW-Auth': ip.leaseweb_api_key } });
        const data = await res.json();
        return { ip: ip.ip_address, ptr: data.reverseLookup || '' };
      } catch { return { ip: ip.ip_address, ptr: '', error: 'API error' }; }
    }));
    return reply.send({ success: true, data: results });
  });

  fastify.put('/:id/rdns', async (req, reply) => {
    const { ip, ptr } = req.body || {};
    if (!ip || ptr === undefined) return reply.status(400).send({ success: false, error: 'ip and ptr required' });
    const vps = await queryOne('SELECT * FROM vps WHERE id = ?', [req.params.id]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const ipRow = await queryOne(
      'SELECT a.ip_address, p.leaseweb_api_key FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id WHERE a.ip_address = ? AND a.vps_id = ?',
      [ip, vps.id]
    );
    if (!ipRow) return reply.status(404).send({ success: false, error: 'IP not found on this VPS' });
    if (!ipRow.leaseweb_api_key) return reply.status(422).send({ success: false, error: 'No Leaseweb API key configured for this IP pool' });
    const { fetch } = await import('undici');
    const res = await fetch(`https://api.leaseweb.com/ipMgmt/v2/ips/${ip}`, {
      method: 'PUT',
      headers: { 'X-LSW-Auth': ipRow.leaseweb_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reverseLookup: ptr }),
    });
    if (!res.ok) return reply.status(422).send({ success: false, error: `Leaseweb API error: HTTP ${res.status}` });
    await logAction(req.user.id, 'vps_rdns_updated', 'vps', vps.id, { ip, ptr }, req.ip);
    return reply.send({ success: true });
  });

  // Firewall management
  fastify.get('/:id/firewall', async (req, reply) => {
    const vps = await queryOne('SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
    if (!vps || !vps.proxmox_vmid) return reply.status(404).send({ success: false, error: 'VPS not found or not provisioned' });
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      const [rules, options] = await Promise.all([
        proxmox.getFirewallRules(node, vps.proxmox_vmid, vps.type),
        proxmox.getFirewallOptions(node, vps.proxmox_vmid, vps.type),
      ]);
      return reply.send({ success: true, data: { rules: rules || [], options: options || {} } });
    } catch (err) { return reply.status(422).send({ success: false, error: err.message }); }
  });

  fastify.post('/:id/firewall', async (req, reply) => {
    const vps = await queryOne('SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
    if (!vps || !vps.proxmox_vmid) return reply.status(404).send({ success: false, error: 'VPS not found or not provisioned' });
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      await proxmox.addFirewallRule(node, vps.proxmox_vmid, req.body, vps.type);
      await logAction(req.user.id, 'vps_firewall_rule_added', 'vps', vps.id, req.body, req.ip);
      return reply.send({ success: true });
    } catch (err) { return reply.status(422).send({ success: false, error: err.message }); }
  });

  fastify.put('/:id/firewall/:pos', async (req, reply) => {
    const vps = await queryOne('SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
    if (!vps || !vps.proxmox_vmid) return reply.status(404).send({ success: false, error: 'VPS not found or not provisioned' });
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      await proxmox.updateFirewallRule(node, vps.proxmox_vmid, req.params.pos, req.body, vps.type);
      return reply.send({ success: true });
    } catch (err) { return reply.status(422).send({ success: false, error: err.message }); }
  });

  fastify.delete('/:id/firewall/:pos', async (req, reply) => {
    const vps = await queryOne('SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
    if (!vps || !vps.proxmox_vmid) return reply.status(404).send({ success: false, error: 'VPS not found or not provisioned' });
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      await proxmox.deleteFirewallRule(node, vps.proxmox_vmid, req.params.pos, vps.type);
      await logAction(req.user.id, 'vps_firewall_rule_deleted', 'vps', vps.id, { pos: req.params.pos }, req.ip);
      return reply.send({ success: true });
    } catch (err) { return reply.status(422).send({ success: false, error: err.message }); }
  });

  fastify.put('/:id/firewall-options', async (req, reply) => {
    const vps = await queryOne('SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
    if (!vps || !vps.proxmox_vmid) return reply.status(404).send({ success: false, error: 'VPS not found or not provisioned' });
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      await proxmox.setFirewallOptions(node, vps.proxmox_vmid, { ...req.body, policy_in: 'ACCEPT', policy_out: 'ACCEPT' }, vps.type);
      await logAction(req.user.id, 'vps_firewall_options_updated', 'vps', vps.id, req.body, req.ip);
      return reply.send({ success: true });
    } catch (err) { return reply.status(422).send({ success: false, error: err.message }); }
  });

  fastify.get('/:id/console', async (req, reply) => {
    const vps = await queryOne('SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    if (!vps.proxmox_vmid) return reply.status(422).send({ success: false, error: 'VPS not yet provisioned on Proxmox' });

    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      const vncData = vps.type === 'lxc'
        ? await proxmox.getLxcVncProxy(node, vps.proxmox_vmid)
        : await proxmox.getKvmVncProxy(node, vps.proxmox_vmid);
      return reply.send({ success: true, data: vncData });
    } catch (err) {
      return reply.status(422).send({ success: false, error: err.message });
    }
  });

  // Live stats from Proxmox
  fastify.get('/:id/stats', async (req, reply) => {
    const vps = await queryOne('SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
    if (!vps || !vps.proxmox_vmid) return reply.status(422).send({ success: false, error: 'VPS not provisioned' });
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      const stats = vps.type === 'lxc'
        ? await proxmox.getLxcContainerStats(node, vps.proxmox_vmid)
        : await proxmox.getKvmVmStats(node, vps.proxmox_vmid);
      return reply.send({ success: true, data: stats });
    } catch (err) {
      return reply.status(422).send({ success: false, error: err.message });
    }
  });
}
