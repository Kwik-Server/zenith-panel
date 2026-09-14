import { Queue, Worker } from 'bullmq';
import { runAbuseCycle } from '../abuse.js';

const connection = {
  host:     process.env.REDIS_HOST || 'localhost',
  port:     parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASS || undefined,
};

const EVERY_MS = 5 * 60 * 1000;

// One repeatable job, registered idempotently, so running this in every API cluster
// instance still yields a single schedule. runAbuseCycle() also holds a Redis lock, so a
// manual "Poll now" can never overlap a scheduled run.
export async function startAbuseWorker() {
  const queue   = new Queue('abuse', { connection });
  const jobOpts = { removeOnComplete: 20, removeOnFail: 50 };
  if (typeof queue.upsertJobScheduler === 'function') {
    await queue.upsertJobScheduler('abuse-poll', { every: EVERY_MS }, { name: 'abuse_poll', data: {}, opts: jobOpts });
  } else {
    await queue.add('abuse_poll', {}, { ...jobOpts, repeat: { every: EVERY_MS }, jobId: 'abuse-poll' });
  }

  const worker = new Worker('abuse', () => runAbuseCycle(), { connection, concurrency: 1 });
  worker.on('failed', (job, err) => console.error(`Abuse job ${job?.name} failed:`, err.message));
  console.log('Abuse worker started');
  return worker;
}
