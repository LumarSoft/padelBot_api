module.exports = {
  apps: [
    {
      name: process.env.PM2_APP || 'padelbot_api',
      script: 'dist/main.js',
      instances: 2,
      exec_mode: 'cluster',
      autorestart: true,
      max_memory_restart: '500M',
      kill_timeout: 10000,
    },
  ],
}
