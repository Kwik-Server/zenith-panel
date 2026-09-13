import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));

const conn = await mysql.createConnection({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '3306'),
  user:     process.env.DB_USER || 'zenith',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'zenith',
  multipleStatements: true,
});

// Run schema
const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
await conn.query(schema);
console.log('Schema applied');

// Idempotent column upgrades for existing installs (schema.sql only creates tables)
const columnUpgrades = [
  ['ip_addresses', 'is_primary', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Primary (eth0) address of the VPS it is assigned to' AFTER is_ipv6"],
  // Per-plan resource ceilings. 0 = unlimited everywhere, so existing installs keep
  // their current behaviour until an admin fills these in.
  ['plans', 'max_iops_read',  "INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Disk read IOPS ceiling, 0=unlimited' AFTER type"],
  ['plans', 'max_iops_write', "INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Disk write IOPS ceiling, 0=unlimited' AFTER max_iops_read"],
  ['plans', 'max_pids',       "INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'LXC task (pid+thread) ceiling, 0=unlimited' AFTER max_iops_write"],
  ['plans', 'cpu_units',      "INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'CPU scheduler weight under contention, 0=Proxmox default' AFTER max_pids"],
];
for (const [table, column, definition] of columnUpgrades) {
  const [[{ found }]] = await conn.query(
    `SELECT COUNT(*) AS found FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column]
  );
  if (!found) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`Added column ${table}.${column}`);
  }
}

// Backfill: VPS with assigned IPs but no primary flag get their oldest/lowest IP marked primary
await conn.query(
  `UPDATE ip_addresses a
   JOIN (SELECT vps_id, MIN(id) AS id FROM ip_addresses
         WHERE vps_id IS NOT NULL
           AND vps_id NOT IN (SELECT vps_id FROM (SELECT vps_id FROM ip_addresses WHERE is_primary = 1) x)
         GROUP BY vps_id) pick ON pick.id = a.id
   SET a.is_primary = 1`
);

// Default settings
const defaults = {
  panel_name:       'Zenith',
  panel_url:        process.env.PANEL_URL || '',
  smtp_host:        '',
  smtp_port:        '587',
  smtp_user:        '',
  smtp_pass:        '',
  smtp_from:        '',
  smtp_secure:      'false',
  whmcs_api_key:    process.env.WHMCS_API_KEY || uuidv4().replace(/-/g, ''),
};

for (const [key, value] of Object.entries(defaults)) {
  await conn.execute(
    'INSERT INTO settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE `key` = `key`',
    [key, value]
  );
}
console.log('Default settings inserted');

// Default plans
const plans = [
  { name: 'Starter KVM',    cpu: 1,  ram: 1024,  disk: 25,  bandwidth: 1000,  price: 5.00,  type: 'kvm' },
  { name: 'Basic KVM',      cpu: 2,  ram: 2048,  disk: 50,  bandwidth: 2000,  price: 10.00, type: 'kvm' },
  { name: 'Standard KVM',   cpu: 4,  ram: 4096,  disk: 100, bandwidth: 5000,  price: 20.00, type: 'kvm' },
  { name: 'Advanced KVM',   cpu: 6,  ram: 8192,  disk: 200, bandwidth: 10000, price: 40.00, type: 'kvm' },
  { name: 'Starter LXC',    cpu: 1,  ram: 512,   disk: 10,  bandwidth: 1000,  price: 3.00,  type: 'lxc' },
  { name: 'Basic LXC',      cpu: 2,  ram: 1024,  disk: 25,  bandwidth: 2000,  price: 6.00,  type: 'lxc' },
];
for (const p of plans) {
  await conn.execute(
    'INSERT INTO plans (name, cpu, ram, disk, bandwidth, price, type) SELECT ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = ?)',
    [p.name, p.cpu, p.ram, p.disk, p.bandwidth, p.price, p.type, p.name]
  );
}
console.log('Default plans inserted');

// Default templates — admin fills in proxmox_template_id after adding nodes
const templates = [
  { name: 'Ubuntu 22.04 LTS',  type: 'kvm', proxmox_template_id: '', os_family: 'ubuntu', description: 'Set Proxmox VMID of your Ubuntu 22.04 cloud-init template' },
  { name: 'Debian 12',          type: 'kvm', proxmox_template_id: '', os_family: 'debian', description: 'Set Proxmox VMID of your Debian 12 cloud-init template' },
  { name: 'Ubuntu 22.04 LXC',   type: 'lxc', proxmox_template_id: '', os_family: 'ubuntu', description: 'Set Proxmox volid of Ubuntu 22.04 LXC template' },
];
for (const t of templates) {
  await conn.execute(
    'INSERT INTO templates (name, type, proxmox_template_id, os_family, description) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM templates WHERE name = ?)',
    [t.name, t.type, t.proxmox_template_id, t.os_family, t.description, t.name]
  );
}
console.log('Default templates inserted');

// Admin user
const adminEmail    = process.env.ADMIN_EMAIL    || 'admin@example.com';
const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
const hash = await bcrypt.hash(adminPassword, 12);
await conn.execute(
  'INSERT INTO users (email, password, first_name, last_name, role) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = ?)',
  [adminEmail, hash, 'Admin', 'User', 'admin', adminEmail]
);
console.log(`Admin user: ${adminEmail}`);

await conn.end();
console.log('Migration complete');
