import IORedis from 'ioredis';

export const redis = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASS || undefined,
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 500, 5000),
});

redis.on('error', (err) => console.error('Redis error:', err.message));
