import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';

export default async function planRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const rows = await query('SELECT * FROM plans ORDER BY price');
    return reply.send({ success: true, data: rows });
  });

  fastify.post('/', async (req, reply) => {
    const { name, cpu, ram, disk, bandwidth, price, type, max_iops_read, max_iops_write, max_pids, cpu_units } = req.body || {};
    if (!name || !cpu || !ram || !disk) return reply.status(400).send({ success: false, error: 'name, cpu, ram, disk required' });
    const r = await query(
      'INSERT INTO plans (name, cpu, ram, disk, bandwidth, price, type, max_iops_read, max_iops_write, max_pids, cpu_units) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, cpu, ram, disk, bandwidth || 0, price || 0, type || 'kvm',
       max_iops_read || 0, max_iops_write || 0, max_pids || 0, cpu_units || 0]);
    return reply.status(201).send({ success: true, data: { id: r.insertId } });
  });

  fastify.get('/:id', async (req, reply) => {
    const p = await queryOne('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    if (!p) return reply.status(404).send({ success: false, error: 'Plan not found' });
    return reply.send({ success: true, data: p });
  });

  fastify.put('/:id', async (req, reply) => {
    const { name, cpu, ram, disk, bandwidth, price, type, is_active, max_iops_read, max_iops_write, max_pids, cpu_units } = req.body || {};
    await query(
      'UPDATE plans SET name=COALESCE(?,name), cpu=COALESCE(?,cpu), ram=COALESCE(?,ram), disk=COALESCE(?,disk), bandwidth=COALESCE(?,bandwidth), price=COALESCE(?,price), type=COALESCE(?,type), is_active=COALESCE(?,is_active), max_iops_read=COALESCE(?,max_iops_read), max_iops_write=COALESCE(?,max_iops_write), max_pids=COALESCE(?,max_pids), cpu_units=COALESCE(?,cpu_units) WHERE id=?',
      [name??null, cpu??null, ram??null, disk??null, bandwidth??null, price??null, type??null, is_active??null,
       max_iops_read??null, max_iops_write??null, max_pids??null, cpu_units??null, req.params.id]);
    return reply.send({ success: true });
  });

  fastify.delete('/:id', async (req, reply) => {
    const inUse = await queryOne('SELECT id FROM vps WHERE plan_id = ? LIMIT 1', [req.params.id]);
    if (inUse) return reply.status(409).send({ success: false, error: 'Plan in use by existing VPS' });
    await query('DELETE FROM plans WHERE id = ?', [req.params.id]);
    return reply.send({ success: true });
  });
}
