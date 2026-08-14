import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';
import { testConnection, getNodeStats } from '../../services/proxmox.js';
import { logAction } from '../../services/audit.js';

export default async function nodeRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const nodes = await query('SELECT id, name, hostname, port, proxmox_node, storage, backup_storage, type, location, total_cpu, total_ram, total_disk, oversell_ratio, is_active, created_at FROM nodes ORDER BY created_at DESC');
    return reply.send({ success: true, data: nodes });
  });

  fastify.post('/', async (req, reply) => {
    const { name, hostname, port, api_token_id, api_token_secret, proxmox_node, storage, backup_storage, type, location, total_cpu, total_ram, total_disk, oversell_ratio } = req.body || {};
    if (!name || !hostname || !api_token_id || !api_token_secret) {
      return reply.status(400).send({ success: false, error: 'name, hostname, api_token_id, api_token_secret are required' });
    }
    const result = await query(
      'INSERT INTO nodes (name, hostname, port, api_token_id, api_token_secret, proxmox_node, storage, backup_storage, type, location, total_cpu, total_ram, total_disk, oversell_ratio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, hostname, port || 8006, api_token_id, api_token_secret, proxmox_node || 'pve', storage || 'local-lvm', backup_storage || 'local', type || 'both', location || '', total_cpu || 0, total_ram || 0, total_disk || 0, oversell_ratio || 1.0]
    );
    await logAction(req.user.id, 'node_created', 'node', result.insertId, { name }, req.ip);
    return reply.status(201).send({ success: true, data: { id: result.insertId } });
  });

  // Enriched node list for VPS creation: free IPs + allocated resources per node
  fastify.get('/availability', async (req, reply) => {
    const nodes = await query(
      `SELECT
         n.id, n.name, n.location, n.type, n.total_ram, n.total_disk, n.total_cpu, n.oversell_ratio,
         (SELECT COUNT(*) FROM ip_pools ip JOIN ip_addresses ia ON ia.pool_id = ip.id
          WHERE ip.node_id = n.id AND ia.vps_id IS NULL) AS free_ip_count,
         (SELECT COALESCE(SUM(pl.ram),  0) FROM vps v JOIN plans pl ON pl.id = v.plan_id
          WHERE v.node_id = n.id AND v.status NOT IN ('deleted','error')) AS allocated_ram,
         (SELECT COALESCE(SUM(pl.disk), 0) FROM vps v JOIN plans pl ON pl.id = v.plan_id
          WHERE v.node_id = n.id AND v.status NOT IN ('deleted','error')) AS allocated_disk
       FROM nodes n
       WHERE n.is_active = 1
       ORDER BY n.location, n.name`
    );
    // Capacity is scaled by oversell_ratio (e.g. 1.5 lets a 32GB node sell 48GB of RAM)
    return reply.send({
      success: true,
      data: nodes.map(n => ({
        ...n,
        available_ram:  Math.round(n.total_ram  * (n.oversell_ratio || 1)) - n.allocated_ram,
        available_disk: Math.round(n.total_disk * (n.oversell_ratio || 1)) - n.allocated_disk,
      })),
    });
  });

  fastify.get('/:id', async (req, reply) => {
    const node = await queryOne('SELECT id, name, hostname, port, proxmox_node, storage, backup_storage, type, location, total_cpu, total_ram, total_disk, oversell_ratio, is_active, created_at FROM nodes WHERE id = ?', [req.params.id]);
    if (!node) return reply.status(404).send({ success: false, error: 'Node not found' });
    const vpsCount = await queryOne('SELECT COUNT(*) as cnt FROM vps WHERE node_id = ?', [req.params.id]);
    return reply.send({ success: true, data: { ...node, vps_count: vpsCount?.cnt || 0 } });
  });

  fastify.put('/:id', async (req, reply) => {
    const { name, hostname, port, api_token_id, api_token_secret, proxmox_node, storage, backup_storage, type, location, total_cpu, total_ram, total_disk, oversell_ratio, is_active } = req.body || {};
    await query(
      'UPDATE nodes SET name=COALESCE(?,name), hostname=COALESCE(?,hostname), port=COALESCE(?,port), api_token_id=COALESCE(?,api_token_id), api_token_secret=COALESCE(?,api_token_secret), proxmox_node=COALESCE(?,proxmox_node), storage=COALESCE(?,storage), backup_storage=COALESCE(?,backup_storage), type=COALESCE(?,type), location=COALESCE(?,location), total_cpu=COALESCE(?,total_cpu), total_ram=COALESCE(?,total_ram), total_disk=COALESCE(?,total_disk), oversell_ratio=COALESCE(?,oversell_ratio), is_active=COALESCE(?,is_active) WHERE id=?',
      [name??null, hostname??null, port??null, api_token_id??null, api_token_secret??null, proxmox_node??null, storage??null, backup_storage??null, type??null, location??null, total_cpu??null, total_ram??null, total_disk??null, oversell_ratio??null, is_active??null, req.params.id]
    );
    return reply.send({ success: true });
  });

  fastify.delete('/:id', async (req, reply) => {
    const inUse = await queryOne('SELECT id FROM vps WHERE node_id = ? LIMIT 1', [req.params.id]);
    if (inUse) return reply.status(409).send({ success: false, error: 'Node has active VPS — migrate them first' });
    await query('DELETE FROM nodes WHERE id = ?', [req.params.id]);
    return reply.send({ success: true });
  });

  // Test Proxmox API connection
  fastify.post('/:id/test', async (req, reply) => {
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [req.params.id]);
    if (!node) return reply.status(404).send({ success: false, error: 'Node not found' });
    try {
      await testConnection(node);
      return reply.send({ success: true, message: 'Proxmox API connection successful' });
    } catch (err) {
      return reply.status(422).send({ success: false, error: `Connection failed: ${err.message}` });
    }
  });

  // Live resource stats from Proxmox
  fastify.get('/:id/stats', async (req, reply) => {
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [req.params.id]);
    if (!node) return reply.status(404).send({ success: false, error: 'Node not found' });
    try {
      const stats = await getNodeStats(node);
      return reply.send({ success: true, data: stats });
    } catch (err) {
      return reply.status(422).send({ success: false, error: err.message });
    }
  });
}
