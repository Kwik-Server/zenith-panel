import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';

const connection = { host: process.env.REDIS_HOST || 'localhost', port: parseInt(process.env.REDIS_PORT || '6379'), password: process.env.REDIS_PASS || undefined };

export const vpsQueue    = new Queue('vps',    { connection });
export const backupQueue = new Queue('backup', { connection });

export function addVpsJob(type, data, opts = {}) {
  return vpsQueue.add(type, data, { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, ...opts });
}

export function addBackupJob(type, data, opts = {}) {
  return backupQueue.add(type, data, { attempts: 2, ...opts });
}
