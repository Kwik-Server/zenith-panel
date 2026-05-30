import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';
import { addVpsJob } from '../../services/queue.js';
import { logAction } from '../../services/audit.js';
import { v4 as uuidv4 } from 'uuid';
import * as proxmox from '../../services/proxmox.js';

export default async function vpsRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const { page = 1, limit = 20, status, node_id, user_id } = req.query;
    const offset = (page - 1) * limit;
    let where = 'WHERE 1=1';
    const params = [];
    if (status)  { where += ' AND v.status = ?';  params.push(status); }
    if (node_id) { where += ' AND v.node_id = ?'; params.push(node_id); }
    if (user_id) { where += ' AND v.user_id = ?'; params.push(user_id); }
    const rows = await query(
      `SELECT v.*, u.email as user_email, n.name as node_name, p.name as plan_name,
              t.name as template_name,
              (SELECT ip_address FROM ip_addresses WHERE vps_id = v.id LIMIT 1) as ip_address
       FROM vps v
       JOIN users u ON v.user_id = u.id
       JOIN nodes n ON v.node_id = n.id
       JOIN plans p ON v.plan_id = p.id
       LEFT JOIN templates t ON v.template_id = t.id
       ${where} ORDER BY v.created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`,
      params
    );
    const [{ total }] = await query(`SELECT COUNT(*) as total FROM vps v ${where}`, params);
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
      const selectedIps = await query(
        `SELECT a.*, p.netmask, p.gateway FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id
         WHERE a.id IN (${ip_address_ids.map(() => '?').join(',')}) AND a.vps_id IS NULL`,
        ip_address_ids
      );
      primaryIp = selectedIps[0] || null;
      additionalIps = selectedIps.slice(1);
    } else {
      primaryIp = await queryOne(
        'SELECT a.*, p.netmask, p.gateway FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id WHERE a.vps_id IS NULL AND p.node_id = ? LIMIT 1',
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
    }));

    await addVpsJob('create_vps', {
      vpsId, taskId: task.insertId, root_password,
      ip_address_id:      freeIp?.id || null,
      ip:                 freeIp?.ip_address || null,
      additional_ip_configs: additionalIpConfigs,
      ipConfig,
    });

    await logAction(req.user.id, 'vps_created', 'vps', vpsId, { hostname }, req.ip);
    return reply.status(202).send({ success: true, message: 'VPS creation queued', data: { vps: { id: vpsId, uuid, status: 'creating' } } });
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

  fastify.put('/:id', async (req, reply) => {
    const { hostname, notes } = req.body || {};
    await query('UPDATE vps SET hostname=COALESCE(?,hostname), notes=COALESCE(?,notes) WHERE id=?', [hostname, notes, req.params.id]);
    return reply.send({ success: true });
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
  fastify.get('/:id/console/ws', { websocket: true }, (socket, req) => {
    return new Promise(async (resolve) => {
      try {
        const vps = await queryOne(
          'SELECT v.*, n.*, v.type as type FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?',
          [req.params.id]
        );
        if (!vps || !vps.proxmox_vmid) { socket.close(1008, 'VPS not found'); return resolve(); }

        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
        const vncData = vps.type === 'lxc'
          ? await proxmox.getLxcVncProxy(node, vps.proxmox_vmid)
          : await proxmox.getKvmVncProxy(node, vps.proxmox_vmid);

        const wsUrl = `wss://${vncData.host}:${vncData.port}${vncData.path}?port=${vncData.vncPort}&vncticket=${encodeURIComponent(vncData.ticket)}`;
        const auth  = `PVEAPIToken=${node.api_token_id}=${node.api_token_secret}`;

        const { default: WS } = await import('ws');
        const upstream = new WS(wsUrl, ['binary'], {
          headers: { Authorization: auth },
          rejectUnauthorized: false,
        });

        upstream.on('open', () => {
          socket.on('message', (data) => { if (upstream.readyState === 1) upstream.send(data); });
        });
        upstream.on('message', (data) => { try { socket.send(data); } catch {} });
        upstream.on('error',   (err)  => { console.error('Proxmox WS:', err.message); try { socket.close(1011); } catch {} resolve(); });
        upstream.on('close',   ()     => { try { socket.close(); } catch {} resolve(); });
        socket.on('close',     ()     => { upstream.close(); resolve(); });

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
       WHERE i.vps_id = ?`, [req.params.id]
    );
    return reply.send({ success: true, data: ips });
  });

  fastify.post('/:id/ips', async (req, reply) => {
    const { ip_address_id } = req.body || {};
    if (!ip_address_id) return reply.status(400).send({ success: false, error: 'ip_address_id required' });
    const ip = await queryOne('SELECT * FROM ip_addresses WHERE id = ? AND vps_id IS NULL', [ip_address_id]);
    if (!ip) return reply.status(404).send({ success: false, error: 'IP not found or already assigned' });
    await query('UPDATE ip_addresses SET vps_id = ?, assigned_at = NOW() WHERE id = ?', [req.params.id, ip_address_id]);
    return reply.send({ success: true });
  });

  fastify.delete('/:id/ips/:ipId', async (req, reply) => {
    const ip = await queryOne('SELECT * FROM ip_addresses WHERE id = ? AND vps_id = ?', [req.params.ipId, req.params.id]);
    if (!ip) return reply.status(404).send({ success: false, error: 'IP not found on this VPS' });
    await query('UPDATE ip_addresses SET vps_id = NULL, assigned_at = NULL WHERE id = ?', [req.params.ipId]);
    return reply.send({ success: true });
  });

  fastify.get('/:id/console', async (req, reply) => {
    const vps = await queryOne('SELECT v.*, n.*, v.type as type FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
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
    const vps = await queryOne('SELECT v.*, n.*, v.type as type FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [req.params.id]);
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
