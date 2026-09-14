import { query, queryOne } from '../config/database.js';
import { whmcsAuth } from '../middleware/authenticate.js';
import { addVpsJob } from '../services/queue.js';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import * as proxmox from '../services/proxmox.js';

export default async function whmcsRoutes(fastify) {
  fastify.addHook('preHandler', whmcsAuth);

  fastify.get('/ping', async (req, reply) => {
    return reply.send({ success: true, data: { status: 'ok', version: '1.0.0' } });
  });

  fastify.get('/templates', async (req, reply) => {
    const { type } = req.query;
    const rows = type
      ? await query('SELECT id, name, type, os_family FROM templates WHERE is_active = 1 AND type = ? ORDER BY name', [type])
      : await query('SELECT id, name, type, os_family FROM templates WHERE is_active = 1 ORDER BY name');
    return reply.send({ success: true, data: rows });
  });

  // Generate magic link token for auto-login
  fastify.post('/autologin', async (req, reply) => {
    const { user_email } = req.body || {};
    if (!user_email) return reply.status(400).send({ success: false, error: 'user_email required' });
    const user = await queryOne('SELECT * FROM users WHERE email = ? AND is_active = 1', [user_email]);
    if (!user) return reply.status(404).send({ success: false, error: 'User not found' });
    const token = uuidv4().replace(/-/g, '') + uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    await query('INSERT INTO login_tokens (token, user_id, expires_at) VALUES (?, ?, ?)', [token, user.id, expiresAt]);
    return reply.send({ success: true, data: { token, expires_at: expiresAt } });
  });

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

    const plan = await queryOne('SELECT * FROM plans WHERE id = ?', [plan_id]);
    if (!plan) return reply.status(400).send({ success: false, error: 'Plan not found' });

    const pickBestNode = async () => {
      const candidates = await query(
        `SELECT
           n.id, n.total_ram, n.total_disk, n.oversell_ratio,
           (SELECT COUNT(*) FROM ip_pools ip JOIN ip_addresses ia ON ia.pool_id = ip.id
            WHERE ip.node_id = n.id AND ia.vps_id IS NULL) AS free_ip_count,
           (SELECT COALESCE(SUM(pl.ram),  0) FROM vps v JOIN plans pl ON pl.id = v.plan_id
            WHERE v.node_id = n.id AND v.status NOT IN ('deleted','error')) AS allocated_ram,
           (SELECT COALESCE(SUM(pl.disk), 0) FROM vps v JOIN plans pl ON pl.id = v.plan_id
            WHERE v.node_id = n.id AND v.status NOT IN ('deleted','error')) AS allocated_disk
         FROM nodes n WHERE n.is_active = 1`
      );
      // Capacity is scaled by each node's oversell_ratio (1.0 = no overselling)
      const availRam  = n => Math.round(n.total_ram  * (n.oversell_ratio || 1)) - n.allocated_ram;
      const availDisk = n => Math.round(n.total_disk * (n.oversell_ratio || 1)) - n.allocated_disk;
      const eligible = candidates
        .filter(n => {
          if (n.free_ip_count < 1) return false;
          if (n.total_ram  > 0 && availRam(n)  < plan.ram)  return false;
          if (n.total_disk > 0 && availDisk(n) < plan.disk) return false;
          return true;
        })
        .sort((a, b) => availRam(b) - availRam(a));
      return eligible[0]?.id || null;
    };

    // Use specified node only if it actually has a free IP; otherwise auto-select
    let targetNodeId = null;
    if (node_id) {
      const hasIp = await queryOne(
        `SELECT 1 FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id
         WHERE a.vps_id IS NULL AND p.node_id = ? LIMIT 1`,
        [node_id]
      );
      targetNodeId = hasIp ? node_id : await pickBestNode();
    } else {
      targetNodeId = await pickBestNode();
    }
    if (!targetNodeId) return reply.status(422).send({ success: false, error: 'No suitable node available (check free IPs and resources)' });

    const tpl = await queryOne('SELECT * FROM templates WHERE id = ? AND is_active = 1', [template_id]);
    if (!tpl) return reply.status(400).send({ success: false, error: 'Template not found' });

    // Pre-flight: templates are per-node artifacts, so a node picked by pickBestNode()
    // may not carry this OS. Fail here rather than leaving WHMCS with a broken service.
    const targetNode = await queryOne('SELECT * FROM nodes WHERE id = ?', [targetNodeId]);
    if (!targetNode) return reply.status(422).send({ success: false, error: 'Node not found' });
    const pre = await proxmox.templatePreflight(targetNode, tpl);
    if (!pre.ok) {
      return reply.status(pre.code === 'node_unreachable' ? 503 : 422)
                  .send({ success: false, error: pre.error, code: pre.code });
    }

    const freeIp = await queryOne(
      `SELECT a.*, p.netmask, p.gateway FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id
       WHERE a.vps_id IS NULL AND p.node_id = ? ORDER BY INET_ATON(a.ip_address) LIMIT 1`,
      [targetNodeId]
    );

    const netmaskToCidr = (nm) => nm ? nm.split('.').reduce((acc, o) => acc + (parseInt(o) >>> 0).toString(2).split('').filter(b => b === '1').length, 0) : 24;
    const cidr = netmaskToCidr(freeIp?.netmask);
    const gw = freeIp?.gateway || '';
    const ipConfig = freeIp ? `ip=${freeIp.ip_address}/${cidr}${gw ? ',gw=' + gw : ''}` : 'ip=dhcp';

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
      mac: freeIp?.mac_address || null,
      ipConfig,
    });

    return reply.status(202).send({ success: true, message: 'VPS creation queued', data: { uuid, vps_id: vpsId, hostname, root_password } });
  });

  // Resolve a VPS by its WHMCS service id.
  //
  // The module normally finds a VPS by a UUID stored on the WHMCS side (a vps_uuid
  // custom field, or VPS_UUID:<uuid> in the service notes). VPS created directly in
  // the panel have neither, so Suspend/Terminate failed with "VPS UUID not found" —
  // which is every VPS not provisioned through WHMCS. This lets the module ask Zenith
  // instead, so linking an existing VPS to its service needs only one column set here
  // and no write access to WHMCS at all.
  fastify.get('/by-service/:serviceId', async (req, reply) => {
    const id = parseInt(req.params.serviceId);
    if (!Number.isInteger(id) || id <= 0) {
      return reply.status(400).send({ success: false, error: 'serviceId must be a positive integer' });
    }
    const rows = await query('SELECT uuid, hostname, status FROM vps WHERE whmcs_service_id = ?', [id]);
    if (rows.length === 0) {
      return reply.status(404).send({ success: false, error: `No VPS is linked to WHMCS service ${id}` });
    }
    if (rows.length > 1) {
      // Two VPS claiming one service is a linking mistake. Refuse rather than guess —
      // picking the wrong one here would suspend or delete the wrong customer's server.
      return reply.status(409).send({
        success: false,
        error: `${rows.length} VPS are linked to WHMCS service ${id} (${rows.map(r => r.hostname).join(', ')}) — fix the duplicate link before billing actions can run`,
      });
    }
    return reply.send({ success: true, data: { uuid: rows[0].uuid, hostname: rows[0].hostname, status: rows[0].status } });
  });

  fastify.post('/:uuid/start', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    if (vps.status === 'suspended') return reply.status(422).send({ success: false, error: 'VPS is suspended — unsuspend it first' });
    const task = await query('INSERT INTO tasks (vps_id, type, status) VALUES (?, "start_vps", "pending")', [vps.id]);
    await addVpsJob('start_vps', { vpsId: vps.id, taskId: task.insertId });
    return reply.status(202).send({ success: true, message: 'Start queued' });
  });

  fastify.post('/:uuid/stop', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    if (vps.status === 'suspended') return reply.status(422).send({ success: false, error: 'VPS is suspended' });
    const task = await query('INSERT INTO tasks (vps_id, type, status) VALUES (?, "stop_vps", "pending")', [vps.id]);
    await addVpsJob('stop_vps', { vpsId: vps.id, taskId: task.insertId });
    return reply.status(202).send({ success: true, message: 'Stop queued' });
  });

  fastify.post('/:uuid/restart', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    if (vps.status === 'suspended') return reply.status(422).send({ success: false, error: 'VPS is suspended' });
    const task = await query('INSERT INTO tasks (vps_id, type, status) VALUES (?, "restart_vps", "pending")', [vps.id]);
    await addVpsJob('restart_vps', { vpsId: vps.id, taskId: task.insertId });
    return reply.status(202).send({ success: true, message: 'Restart queued' });
  });

  fastify.post('/:uuid/reinstall', async (req, reply) => {
    const { root_password, template_id } = req.body || {};
    if (!root_password) return reply.status(400).send({ success: false, error: 'root_password required' });
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const tplId = template_id || vps.template_id;
    if (!tplId) return reply.status(422).send({ success: false, error: 'No template set — select an OS to reinstall' });

    // Pre-flight: a reinstall wipes the disk before it clones, so a missing template
    // here would destroy a working VPS and leave nothing to boot.
    const rTpl  = await queryOne('SELECT * FROM templates WHERE id = ?', [tplId]);
    if (!rTpl) return reply.status(422).send({ success: false, error: 'Template not found' });
    const rNode = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    if (!rNode) return reply.status(422).send({ success: false, error: 'Node not found' });
    const rPre = await proxmox.templatePreflight(rNode, rTpl);
    if (!rPre.ok) {
      return reply.status(rPre.code === 'node_unreachable' ? 503 : 422)
                  .send({ success: false, error: rPre.error, code: rPre.code });
    }

    const task = await query('INSERT INTO tasks (vps_id, type, status) VALUES (?, "reinstall_vps", "pending")', [vps.id]);
    await addVpsJob('reinstall_vps', { vpsId: vps.id, taskId: task.insertId, root_password, template_id: tplId });
    return reply.status(202).send({ success: true, message: 'Reinstall queued' });
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

  fastify.get('/:uuid/stats', async (req, reply) => {
    const vps = await queryOne(
      'SELECT v.*, p.cpu as plan_cpu, p.ram as plan_ram, p.disk as plan_disk FROM vps v JOIN plans p ON v.plan_id = p.id WHERE v.uuid = ?',
      [req.params.uuid]
    );
    if (!vps || !vps.proxmox_vmid) return reply.status(404).send({ success: false, error: 'VPS not found or not provisioned' });
    const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
    try {
      const live = vps.type === 'lxc'
        ? await proxmox.getLxcContainerStats(node, vps.proxmox_vmid)
        : await proxmox.getKvmVmStats(node, vps.proxmox_vmid);
      return reply.send({ success: true, data: {
        cpu_pct:   live.cpu,
        ram_used:  live.ram,
        ram_total: vps.plan_ram,
        disk_total:vps.plan_disk,
        netin:     live.netin,
        netout:    live.netout,
      }});
    } catch {
      return reply.send({ success: true, data: { cpu_pct: 0, ram_used: 0, ram_total: vps.plan_ram, disk_total: vps.plan_disk } });
    }
  });

  fastify.get('/:uuid/rdns', async (req, reply) => {
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const ips = await query(
      'SELECT a.ip_address, p.leaseweb_api_key FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id WHERE a.vps_id = ?',
      [vps.id]
    );
    const { fetch } = await import('undici');
    const results = await Promise.all(ips.map(async (ip) => {
      if (!ip.leaseweb_api_key) return { ip: ip.ip_address, ptr: '', error: 'No API key on pool' };
      try {
        const res  = await fetch(`https://api.leaseweb.com/ipMgmt/v2/ips/${ip.ip_address}`, { headers: { 'X-LSW-Auth': ip.leaseweb_api_key } });
        const data = await res.json();
        return { ip: ip.ip_address, ptr: data.reverseLookup || '' };
      } catch { return { ip: ip.ip_address, ptr: '', error: 'API error' }; }
    }));
    return reply.send({ success: true, data: results });
  });

  fastify.put('/:uuid/rdns', async (req, reply) => {
    const { ip, ptr } = req.body || {};
    if (!ip || ptr === undefined) return reply.status(400).send({ success: false, error: 'ip and ptr required' });
    const vps = await queryOne('SELECT * FROM vps WHERE uuid = ?', [req.params.uuid]);
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    const ipRow = await queryOne(
      'SELECT a.ip_address, p.leaseweb_api_key FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id WHERE a.ip_address = ? AND a.vps_id = ?',
      [ip, vps.id]
    );
    if (!ipRow) return reply.status(404).send({ success: false, error: 'IP not found on this VPS' });
    if (!ipRow.leaseweb_api_key) return reply.status(422).send({ success: false, error: 'No Leaseweb API key on this pool' });
    const { fetch } = await import('undici');
    const res = await fetch(`https://api.leaseweb.com/ipMgmt/v2/ips/${ip}`, {
      method: 'PUT',
      headers: { 'X-LSW-Auth': ipRow.leaseweb_api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reverseLookup: ptr }),
    });
    if (!res.ok) return reply.status(422).send({ success: false, error: `Leaseweb API error: HTTP ${res.status}` });
    return reply.send({ success: true });
  });

  fastify.get('/:uuid/status', async (req, reply) => {
    const vps = await queryOne(
      `SELECT v.*, p.cpu, p.ram, p.disk, t.name as template_name,
              (SELECT ip_address FROM ip_addresses WHERE vps_id = v.id LIMIT 1) as ip_address
       FROM vps v JOIN plans p ON v.plan_id = p.id LEFT JOIN templates t ON v.template_id = t.id WHERE v.uuid = ?`,
      [req.params.uuid]
    );
    if (!vps) return reply.status(404).send({ success: false, error: 'VPS not found' });
    return reply.send({ success: true, data: {
      uuid: vps.uuid, status: vps.status, hostname: vps.hostname,
      ip_address: vps.ip_address, cpu: vps.cpu, ram: vps.ram, disk: vps.disk, type: vps.type,
      proxmox_vmid: vps.proxmox_vmid, template_name: vps.template_name,
    }});
  });
}
