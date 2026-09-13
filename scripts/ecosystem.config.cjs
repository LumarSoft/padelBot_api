const path = require('node:path')

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP || 'padelbot_api',
      cwd: path.resolve(__dirname, '..'),
      script: 'dist/src/main.js',
      // The shared PM2 daemon on the VPS currently runs under Node 18. Cluster workers
      // inherit that runtime, which is unsupported by Nest 11 and Prisma 7. In fork mode
      // PM2 honors this explicit Node 22 interpreter without affecting the other apps.
      interpreter: process.env.PM2_NODE_INTERPRETER || process.execPath,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '500M',
      kill_timeout: 10000,
    },
  ],
}
