const path = require('node:path')

const root = path.resolve(__dirname, '..')
const logDir = process.env.PM2_LOG_DIR || path.join(root, 'logs')

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP || 'padelbot_api',
      cwd: root,
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
      // Log destinations live here (not only in PM2's saved dump) so recreating the
      // process never silently moves the logs back to ~/.pm2/logs/padelbot-api-*.log.
      // PM2 only applies path changes on delete + start; deploy.sh handles that.
      out_file: path.join(logDir, 'out.log'),
      error_file: path.join(logDir, 'err.log'),
      log_file: path.join(logDir, 'combined.log'),
      merge_logs: true,
      log_date_format: 'YYYY-MM-DDTHH:mm:ss',
      env: {
        // Nest's ConsoleLogger writes ANSI colors otherwise, which breaks grep on the files.
        NO_COLOR: '1',
      },
    },
  ],
}
