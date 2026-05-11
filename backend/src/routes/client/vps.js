import { query, queryOne } from '../../config/database.js';
import { authenticate } from '../../middleware/authenticate.js';
import { addVpsJob } from '../../services/queue.js';
import { addBackupJob } from '../../services/queue.js';
import * as proxmox from '../../services/proxmox.js';

async function getVpsForUser(vpsId, userId, role) {
  const q = role === 'admin'
    ? 'SELECT v.*, p.cpu, p.ram, p.disk, p.bandwidth, n.name as node_name, t.name as template_name FROM vps v JOIN plans p ON v.plan_id = p.id JOIN nodes n ON v.node_id = n.id LEFT JOIN templates t ON v.template_id = t.id WHERE v.id = ?'
    : 'SELECT v.*, p.cpu, p.ram, p.disk, p.bandwidth, n.name as node_name, t.name as template_name FROM vps v JOIN plans p ON v.plan_id = p.id JOIN nodes n ON v.node_id = n.id LEFT JOIN templates t ON v.template_id = t.id WHERE v.id = ? AND v.user_id = ?';
  const params = role === 'admin' ? [vpsId] : [vpsId, userId];
  return queryOne(q, params);
}

export default async function clientVpsRoutes(fastify) {
  fastify.addHook('preHandler', authenticate);

  fastify.get('/templates', async (req, reply) => {
    const rows = await query('SELECT id, name, type, os_family FROM templates WHERE is_active = 1 ORDER BY name');
    return reply.send({ success: true, data: rows });
  });

  fastify.get('/', async (req, reply) => {
    const rows = await query(
      `SELECT v.id, v.hostname, v.status, v.type, v.created_at, p.cpu, p.ram, p.disk,
              (SELECT ip_address FROM ip_addresses WHERE vps_id = v.id LIMIT 1) as ip_address,
              n.name as node_name
       FROM vps v JOIN plans p ON v.plan_id = p.id JOIN nodes n ON v.node_id = n.id
       WHERE v.user_id = ? ORDER BY v.created_at DESC`,
      [req.user.id]
    );
    return reply.send({ success: true, data: rows });
  });

  fastify.get('/:id', async (req, reply) => {
    const vps = await getVpsForUser(req.params.id, req.user.id, req.user.role);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const ips = await query('SELECT * FROM ip_addresses WHERE vps_id = ?', [vps.id]);
    return reply.send({ success: true, data: { ...vps, ip_addresses: ips } });
  });

  fastify.get('/:id/stats', async (req, reply) => {
    const vps = await getVpsForUser(req.params.id, req.user.id, req.user.role);
    if (!vps || !vps.proxmox_vmid) return reply.status(422).send({ success: false, error: 'VPS not available' });
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

  const powerActions = ['start', 'stop', 'restart'];
  for (const action of powerActions) {
    fastify.post(`/:id/${action}`, async (req, reply) => {
      const vps = await getVpsForUser(req.params.id, req.user.id, req.user.role);
      if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
      if (vps.status === 'suspended') return reply.status(422).send({ success: false, error: 'VPS is suspended' });
      const task = await query('INSERT INTO tasks (vps_id, user_id, type, status) VALUES (?, ?, ?, "pending")', [vps.id, req.user.id, `${action}_vps`]);
      await addVpsJob(`${action}_vps`, { vpsId: vps.id, taskId: task.insertId });
      return reply.status(202).send({ success: true, message: `${action} queued` });
    });
  }

  fastify.post('/:id/reinstall', async (req, reply) => {
    const vps = await getVpsForUser(req.params.id, req.user.id, req.user.role);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const { root_password, template_id } = req.body || {};
    if (!root_password) return reply.status(400).send({ success: false, error: 'root_password required' });
    const task = await query('INSERT INTO tasks (vps_id, user_id, type, status) VALUES (?, ?, "reinstall_vps", "pending")', [vps.id, req.user.id]);
    await addVpsJob('reinstall_vps', { vpsId: vps.id, taskId: task.insertId, root_password, template_id: template_id || null });
    return reply.status(202).send({ success: true, message: 'Reinstall queued' });
  });

  // WebSocket VNC proxy for client portal
  fastify.get('/:id/console/ws', { websocket: true }, (socket, req) => {
    return new Promise(async (resolve) => {
      try {
        const vps = await getVpsForUser(req.params.id, req.user?.id, req.user?.role);
        if (!vps || !vps.proxmox_vmid) { socket.close(1008, 'VPS not found'); return resolve(); }

        const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
        const vncData = vps.type === 'lxc'
          ? await proxmox.getLxcVncProxy(node, vps.proxmox_vmid)
          : await proxmox.getKvmVncProxy(node, vps.proxmox_vmid);

        const wsUrl = `wss://${vncData.host}:${vncData.port}${vncData.path}?port=${vncData.vncPort}&vncticket=${encodeURIComponent(vncData.ticket)}`;
        const auth  = `PVEAPIToken=${node.api_token_id}=${node.api_token_secret}`;

        const { default: WS } = await import('ws');
        const upstream = new WS(wsUrl, ['binary'], { headers: { Authorization: auth }, rejectUnauthorized: false });

        upstream.on('open', () => { socket.on('message', (data) => { if (upstream.readyState === 1) upstream.send(data); }); });
        upstream.on('message', (data) => { try { socket.send(data); } catch {} });
        upstream.on('error',   (err)  => { console.error('Client WS:', err.message); try { socket.close(1011); } catch {} resolve(); });
        upstream.on('close',   ()     => { try { socket.close(); } catch {} resolve(); });
        socket.on('close',     ()     => { upstream.close(); resolve(); });
      } catch (err) {
        console.error('Client console WS error:', err.message);
        try { socket.close(1011); } catch {}
        resolve();
      }
    });
  });

  fastify.get('/:id/console', async (req, reply) => {
    const vps = await getVpsForUser(req.params.id, req.user.id, req.user.role);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    if (vps.status === 'suspended') return reply.status(422).send({ success: false, error: 'VPS is suspended' });
    if (!vps.proxmox_vmid) return reply.status(422).send({ success: false, error: 'VPS not yet provisioned' });
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

  fastify.get('/:id/backups', async (req, reply) => {
    const vps = await getVpsForUser(req.params.id, req.user.id, req.user.role);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const backups = await query('SELECT * FROM backups WHERE vps_id = ? ORDER BY created_at DESC', [vps.id]);
    return reply.send({ success: true, data: backups });
  });

  fastify.post('/:id/backup', async (req, reply) => {
    const vps = await getVpsForUser(req.params.id, req.user.id, req.user.role);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    await addBackupJob('create_backup', { vpsId: vps.id });
    return reply.status(202).send({ success: true, message: 'Backup queued' });
  });

  fastify.post('/:id/backups/:backupId/restore', async (req, reply) => {
    const vps = await getVpsForUser(req.params.id, req.user.id, req.user.role);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    await addBackupJob('restore_backup', { vpsId: vps.id, backupId: req.params.backupId });
    return reply.status(202).send({ success: true, message: 'Restore queued' });
  });
}
