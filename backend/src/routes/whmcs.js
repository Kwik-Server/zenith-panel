import { query, queryOne } from '../config/database.js';
import { whmcsAuth } from '../middleware/authenticate.js';
import { addVpsJob } from '../services/queue.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';

export default async function whmcsRoutes(fastify) {
  fastify.addHook('preHandler', whmcsAuth);

  fastify.post('/provision', async (req, reply) => {
    const { plan_id, template_id, hostname, root_password, user_email, whmcs_service_id, node_id } = req.body || {};
    if (!plan_id || !template_id || !hostname || !root_password || !user_email) {
      return reply.status(400).send({ success: false, error: 'plan_id, template_id, hostname, root_password, user_email required' });
    }

    // Find or create user
    let user = await queryOne('SELECT * FROM users WHERE email = ?', [user_email]);
    if (!user) {
      const tempPass = await bcrypt.hash(uuidv4(), 10);
      const r = await query('INSERT INTO users (email, password, role) VALUES (?, ?, "client")', [user_email, tempPass]);
      user = { id: r.insertId, email: user_email };
    }

    // Pick node (specified or least loaded)
    let targetNodeId = node_id;
    if (!targetNodeId) {
      const n = await queryOne('SELECT id FROM nodes WHERE is_active = 1 ORDER BY (SELECT COUNT(*) FROM vps WHERE node_id = nodes.id) ASC LIMIT 1');
      targetNodeId = n?.id;
    }
    if (!targetNodeId) return reply.status(422).send({ success: false, error: 'No active nodes available' });

    const tpl = await queryOne('SELECT * FROM templates WHERE id = ? AND is_active = 1', [template_id]);
    if (!tpl) return reply.status(400).send({ success: false, error: 'Template not found' });

    const freeIp = await queryOne('SELECT * FROM ip_addresses WHERE vps_id IS NULL AND pool_id IN (SELECT id FROM ip_pools WHERE node_id = ?) LIMIT 1', [targetNodeId]);

    const uuid = uuidv4();
    const r = await query(
      'INSERT INTO vps (uuid, hostname, user_id, node_id, plan_id, template_id, type, status, whmcs_service_id) VALUES (?, ?, ?, ?, ?, ?, ?, "creating", ?)',
      [uuid, hostname, user.id, targetNodeId, plan_id, template_id, tpl.type, whmcs_service_id || null]
    );
    const vpsId = r.insertId;

    const task = await query('INSERT INTO tasks (vps_id, type, status) VALUES (?, "create_vps", "pending")', [vpsId]);
    await addVpsJob('create_vps', {
      vpsId, taskId: task.insertId, root_password,
      ip_address_id: freeIp?.id || null,
      ip: freeIp?.ip_address || null,
      ipConfig: freeIp ? `ip=${freeIp.ip_address}/24,gw=${freeIp.gateway || ''}` : 'ip=dhcp',
    });

    return reply.status(202).send({ success: true, message: 'VPS creation queued', data: { uuid, vps_id: vpsId, hostname, root_password } });
  });

  fastify.post('/:uuid/suspend', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const task = await query('INSERT INTO tasks (vps_id, type, status) VALUES (?, "suspend_vps", "pending")', [vps.id]);
    await addVpsJob('suspend_vps', { vpsId: vps.id, taskId: task.insertId });
    return reply.status(202).send({ success: true });
  });

  fastify.post('/:uuid/unsuspend', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const task = await query('INSERT INTO tasks (vps_id, type, status) VALUES (?, "unsuspend_vps", "pending")', [vps.id]);
    await addVpsJob('unsuspend_vps', { vpsId: vps.id, taskId: task.insertId });
    return reply.status(202).send({ success: true });
  });

  fastify.delete('/:uuid', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const task = await query('INSERT INTO tasks (vps_id, type, status) VALUES (?, "delete_vps", "pending")', [vps.id]);
    await addVpsJob('delete_vps', { vpsId: vps.id, taskId: task.insertId });
    return reply.status(202).send({ success: true });
  });

  fastify.get('/:uuid/status', async (req, reply) => {
    const vps = await queryOne('SELECT v.*, (SELECT ip_address FROM ip_addresses WHERE vps_id = v.id LIMIT 1) as ip FROM vps v WHERE v.uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    return reply.send({ success: true, data: { uuid: vps.uuid, status: vps.status, hostname: vps.hostname, ip: vps.ip } });
  });
}
