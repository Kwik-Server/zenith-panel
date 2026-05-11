module.exports = {
  apps: [
    {
      name:      'zenith-api',
      script:    'src/index.js',
      cwd:       '/opt/zenith/backend',
      instances: 'max',
      exec_mode: 'cluster',
      env: { NODE_ENV: 'production' },
      error_file: '/var/log/zenith/api-error.log',
      out_file:   '/var/log/zenith/api-out.log',
      merge_logs: true,
    },
    {
      name:      'zenith-worker',
      script:    'src/services/workers/vps.worker.js',
      cwd:       '/opt/zenith/backend',
      instances: 1,
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      error_file: '/var/log/zenith/worker-error.log',
      out_file:   '/var/log/zenith/worker-out.log',
    },
  ],
};
