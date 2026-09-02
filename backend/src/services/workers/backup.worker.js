import { Worker } from 'bullmq';
import { query, queryOne } from '../../config/database.js';
import * as proxmox from '../proxmox.js';
import { v4 as uuidv4 } from 'uuid';

const connection = {
  host:     process.env.REDIS_HOST || 'localhost',
  port:     parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASS || undefined,
};

async function processBackupJob(job) {
  const { vpsId } = job.data;

  const vps = await queryOne(
    'SELECT v.* FROM vps v JOIN nodes n ON v.node_id = n.id WHERE v.id = ?',
    [vpsId]
  );
  if (!vps) throw new Error(`VPS ${vpsId} not found`);

  const node = await queryOne('SELECT * FROM nodes WHERE id = ?', [vps.node_id]);
  const vmid = vps.proxmox_vmid;
  const type = vps.type || 'kvm';

  if (job.name === 'create_backup') {
    const storage = node.backup_storage || node.storage || 'local';

    // Proxmox vzdump returns the UPID; backup file is found in storage after completion
    await proxmox.createBackup(node, vmid, type, storage);

    // Find the newly created backup in storage
    const pveNode = node.proxmox_node || 'pve';
    const contents = await proxmox.listStorageTemplates(node, storage).catch(() => []);
    const backupFile = contents
      .filter(c => c.volid && c.volid.includes(`vzdump`) && c.volid.includes(String(vmid)))
      .sort((a, b) => b.ctime - a.ctime)[0];

    await query(
      'INSERT INTO backups (vps_id, name, file_path, size, created_at) VALUES (?, ?, ?, ?, NOW())',
      [vpsId, `backup-${new Date().toISOString().slice(0,10)}`, backupFile?.volid || '', backupFile?.size || 0]
    );

  } else if (job.name === 'restore_backup') {
    const backup = await queryOne('SELECT * FROM backups WHERE id = ?', [job.data.backupId]);
    if (!backup) throw new Error('Backup not found');
    await proxmox.restoreBackup(node, vmid, backup.file_path, type, node.storage);
  }
}

export function startBackupWorker() {
  const worker = new Worker('backup', processBackupJob, { connection, concurrency: 2 });
  worker.on('failed', (job, err) => console.error(`Backup job failed:`, err.message));
  console.log('Backup worker started');
  return worker;
}
