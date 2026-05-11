import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';

export default async function ipPoolRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const pools = await query('SELECT p.*, COUNT(i.id) as total_ips, SUM(i.vps_id IS NOT NULL) as used_ips FROM ip_pools p LEFT JOIN ip_addresses i ON p.id = i.pool_id GROUP BY p.id');
    return reply.send({ success: true, data: pools });
  });

  // Get available (unassigned) IPs for a specific node
  fastify.get('/available', async (req, reply) => {
    const { node_id } = req.query;
    if (!node_id) return reply.status(400).send({ success: false, error: 'node_id required' });
    const ips = await query(
      `SELECT i.*, p.name as pool_name, p.gateway, p.netmask
       FROM ip_addresses i
       JOIN ip_pools p ON i.pool_id = p.id
       WHERE i.vps_id IS NULL AND p.node_id = ?
       ORDER BY p.name, i.ip_address`,
      [node_id]
    );
    return reply.send({ success: true, data: ips });
  });

  fastify.post('/', async (req, reply) => {
    const { name, gateway, netmask, node_id } = req.body || {};
    if (!name) return reply.status(400).send({ success: false, error: 'name required' });
    const r = await query('INSERT INTO ip_pools (name, gateway, netmask, node_id) VALUES (?, ?, ?, ?)', [name, gateway || '', netmask || '', node_id || null]);
    return reply.status(201).send({ success: true, data: { id: r.insertId } });
  });

  fastify.get('/:id', async (req, reply) => {
    const pool = await queryOne('SELECT * FROM ip_pools WHERE id = ?', [req.params.id]);
    if (!pool) return reply.status(404).send({ success: false, error: 'Pool not found' });
    const ips = await query('SELECT i.*, v.hostname as vps_hostname FROM ip_addresses i LEFT JOIN vps v ON i.vps_id = v.id WHERE i.pool_id = ?', [req.params.id]);
    return reply.send({ success: true, data: { ...pool, ips } });
  });

  fastify.delete('/:id', async (req, reply) => {
    const inUse = await queryOne('SELECT id FROM ip_addresses WHERE pool_id = ? AND vps_id IS NOT NULL LIMIT 1', [req.params.id]);
    if (inUse) return reply.status(409).send({ success: false, error: 'Pool has assigned IPs' });
    await query('DELETE FROM ip_addresses WHERE pool_id = ?', [req.params.id]);
    await query('DELETE FROM ip_pools WHERE id = ?', [req.params.id]);
    return reply.send({ success: true });
  });

  fastify.post('/:id/ips', async (req, reply) => {
    const { ip_addresses } = req.body || {};
    if (!Array.isArray(ip_addresses) || !ip_addresses.length) return reply.status(400).send({ success: false, error: 'ip_addresses array required' });
    const pool = await queryOne('SELECT * FROM ip_pools WHERE id = ?', [req.params.id]);
    if (!pool) return reply.status(404).send({ success: false, error: 'Pool not found' });
    let added = 0;
    for (const ip of ip_addresses) {
      try {
        await query('INSERT INTO ip_addresses (ip_address, pool_id) VALUES (?, ?)', [ip.trim(), req.params.id]);
        added++;
      } catch {}
    }
    return reply.send({ success: true, message: `${added} IPs added` });
  });

  fastify.delete('/:id/ips/:ipId', async (req, reply) => {
    const ip = await queryOne('SELECT * FROM ip_addresses WHERE id = ? AND pool_id = ?', [req.params.ipId, req.params.id]);
    if (!ip) return reply.status(404).send({ success: false, error: 'IP not found' });
    if (ip.vps_id) return reply.status(409).send({ success: false, error: 'IP is assigned to a VPS' });
    await query('DELETE FROM ip_addresses WHERE id = ?', [req.params.ipId]);
    return reply.send({ success: true });
  });
}
