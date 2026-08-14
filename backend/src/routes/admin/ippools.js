import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';

// Accepts aa:bb:cc:dd:ee:ff or aa-bb-cc-dd-ee-ff, returns lowercase colon form (or null)
function normalizeMac(raw) {
  if (!raw) return null;
  const mac = String(raw).trim().toLowerCase().replace(/-/g, ':');
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac) ? mac : null;
}

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
    const { name, gateway, netmask, node_id, leaseweb_api_key } = req.body || {};
    if (!name) return reply.status(400).send({ success: false, error: 'name required' });
    const r = await query('INSERT INTO ip_pools (name, gateway, netmask, node_id, leaseweb_api_key) VALUES (?, ?, ?, ?, ?)', [name, gateway || '', netmask || '', node_id || null, leaseweb_api_key || null]);
    return reply.status(201).send({ success: true, data: { id: r.insertId } });
  });

  fastify.put('/:id', async (req, reply) => {
    const { name, gateway, netmask, node_id, leaseweb_api_key } = req.body || {};
    // Treat empty string the same as omitted — COALESCE will keep the existing value
    const gwVal   = (gateway === '' || gateway == null) ? null : gateway;
    const nmVal   = (netmask === '' || netmask == null) ? null : netmask;
    // node_id: empty string means "unassign"; a numeric value re-assigns to that node
    const nodeVal = (node_id === '' || node_id == null) ? null : parseInt(node_id);
    await query(
      'UPDATE ip_pools SET name=COALESCE(?,name), gateway=COALESCE(?,gateway), netmask=COALESCE(?,netmask), node_id=?, leaseweb_api_key=? WHERE id=?',
      [name??null, gwVal, nmVal, nodeVal, leaseweb_api_key||null, req.params.id]
    );
    return reply.send({ success: true });
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
    let skipped = 0;
    for (const entry of ip_addresses) {
      // Each entry is "IP" or "IP,MAC" / "IP MAC" — MAC needed for providers like
      // OneProvider that bind IPs to portal-generated MACs (Leaseweb: leave empty)
      const [ipRaw, macRaw] = String(entry).trim().split(/[,;\s]+/);
      const ip = (ipRaw || '').trim();
      if (!ip) { skipped++; continue; }
      const mac = normalizeMac(macRaw);
      if (macRaw && !mac) { skipped++; continue; } // malformed MAC — don't silently drop it
      const exists = await queryOne('SELECT id FROM ip_addresses WHERE ip_address = ?', [ip]);
      if (exists) { skipped++; continue; }
      try {
        await query('INSERT INTO ip_addresses (ip_address, mac_address, pool_id) VALUES (?, ?, ?)', [ip, mac, req.params.id]);
        added++;
      } catch { skipped++; }
    }
    const msg = skipped > 0 ? `${added} IPs added, ${skipped} skipped (already exist or invalid format)` : `${added} IPs added`;
    return reply.send({ success: true, message: msg });
  });

  // Set or clear the MAC address of a single IP (empty string clears it)
  fastify.put('/:id/ips/:ipId', async (req, reply) => {
    const { mac_address } = req.body || {};
    const ip = await queryOne('SELECT * FROM ip_addresses WHERE id = ? AND pool_id = ?', [req.params.ipId, req.params.id]);
    if (!ip) return reply.status(404).send({ success: false, error: 'IP not found' });
    const mac = mac_address ? normalizeMac(mac_address) : null;
    if (mac_address && !mac) return reply.status(400).send({ success: false, error: 'Invalid MAC address (expected aa:bb:cc:dd:ee:ff)' });
    await query('UPDATE ip_addresses SET mac_address = ? WHERE id = ?', [mac, req.params.ipId]);
    return reply.send({ success: true, data: { mac_address: mac } });
  });

  fastify.delete('/:id/ips/:ipId', async (req, reply) => {
    const ip = await queryOne('SELECT * FROM ip_addresses WHERE id = ? AND pool_id = ?', [req.params.ipId, req.params.id]);
    if (!ip) return reply.status(404).send({ success: false, error: 'IP not found' });
    if (ip.vps_id) return reply.status(409).send({ success: false, error: 'IP is assigned to a VPS' });
    await query('DELETE FROM ip_addresses WHERE id = ?', [req.params.ipId]);
    return reply.send({ success: true });
  });
}
