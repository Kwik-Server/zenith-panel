import { query, queryOne } from '../../config/database.js';
import { adminOnly } from '../../middleware/authenticate.js';
import { listAvailableLxcTemplates, downloadLxcTemplate, listStorageTemplates } from '../../services/proxmox.js';

export default async function templateRoutes(fastify) {
  fastify.addHook('preHandler', adminOnly);

  fastify.get('/', async (req, reply) => {
    const rows = await query('SELECT * FROM templates ORDER BY name');
    return reply.send({ success: true, data: rows });
  });

  fastify.post('/', async (req, reply) => {
    const { name, type, proxmox_template_id, os_family, description } = req.body || {};
    if (!name || !type) return reply.status(400).send({ success: false, error: 'name and type required' });
    const r = await query(
      'INSERT INTO templates (name, type, proxmox_template_id, path, os_family, description) VALUES (?, ?, ?, ?, ?, ?)',
      [name, type, proxmox_template_id || '', proxmox_template_id || '', os_family || '', description || '']
    );
    return reply.status(201).send({ success: true, data: { id: r.insertId } });
  });

  fastify.get('/:id', async (req, reply) => {
    const t = await queryOne('SELECT * FROM templates WHERE id = ?', [req.params.id]);
    if (!t) return reply.status(404).send({ success: false, error: 'Template not found' });
    return reply.send({ success: true, data: t });
  });

  fastify.put('/:id', async (req, reply) => {
    const { name, proxmox_template_id, os_family, description, is_active } = req.body || {};
    await query(
      'UPDATE templates SET name=COALESCE(?,name), proxmox_template_id=COALESCE(?,proxmox_template_id), path=COALESCE(?,path), os_family=COALESCE(?,os_family), description=COALESCE(?,description), is_active=COALESCE(?,is_active) WHERE id=?',
      [name, proxmox_template_id, proxmox_template_id, os_family, description, is_active, req.params.id]
    );
    return reply.send({ success: true });
  });

  fastify.delete('/:id', async (req, reply) => {
    const inUse = await queryOne('SELECT id FROM vps WHERE template_id = ? LIMIT 1', [req.params.id]);
    if (inUse) return reply.status(409).send({ success: false, error: 'Template in use by existing VPS' });
    await query('DELETE FROM templates WHERE id = ?', [req.params.id]);
    return reply.send({ success: true });
  });

  // List LXC templates actually installed on the node's storage
  fastify.get('/proxmox/:nodeId/installed', async (req, reply) => {
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [req.params.nodeId]);
    if (!node) return reply.status(404).send({ success: false, error: 'Node not found' });
    const storage = req.query.storage || node.storage || 'local';
    try {
      const all = await listStorageTemplates(node, storage);
      const templates = all.filter(i => i.content === 'vztmpl').map(i => ({
        volid:   i.volid,
        name:    i.volid.split('/').pop(),
        size:    i.size,
        ctime:   i.ctime,
      }));
      return reply.send({ success: true, data: templates });
    } catch (err) {
      return reply.status(422).send({ success: false, error: err.message });
    }
  });

  // List available LXC templates from Proxmox node (for auto-populate)
  fastify.get('/proxmox/:nodeId/available', async (req, reply) => {
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [req.params.nodeId]);
    if (!node) return reply.status(404).send({ success: false, error: 'Node not found' });
    try {
      const templates = await listAvailableLxcTemplates(node);
      return reply.send({ success: true, data: templates });
    } catch (err) {
      return reply.status(422).send({ success: false, error: err.message });
    }
  });

  // Download an LXC template from Proxmox template library to a node
  fastify.post('/proxmox/:nodeId/download', async (req, reply) => {
    const { storage, template } = req.body || {};
    if (!storage || !template) return reply.status(400).send({ success: false, error: 'storage and template required' });
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [req.params.nodeId]);
    if (!node) return reply.status(404).send({ success: false, error: 'Node not found' });
    try {
      await downloadLxcTemplate(node, storage, template);
      return reply.send({ success: true, message: 'Template download queued on Proxmox node' });
    } catch (err) {
      return reply.status(422).send({ success: false, error: err.message });
    }
  });
}
