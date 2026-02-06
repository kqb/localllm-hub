/**
 * PM2 Ecosystem Configuration
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop agent-monitor
 *   pm2 restart agent-monitor
 *   pm2 logs agent-monitor
 *   pm2 monit
 */

module.exports = {
  apps: [{
    name: 'agent-monitor',
    script: './daemon.js',
    cwd: __dirname,
    
    // Restart configuration
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    restart_delay: 4000,
    
    // Logging
    error_file: '/tmp/agent-monitor-error.log',
    out_file: '/tmp/agent-monitor-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Environment
    env: {
      NODE_ENV: 'production',
      REDIS_URL: 'redis://localhost:6379',
      API_PORT: '3848',
    },
    
    // Resource limits
    max_memory_restart: '500M',
    
    // Monitoring
    instances: 1,
    exec_mode: 'fork',
    
    // Watch (disabled in production, enable for development)
    watch: false,
    ignore_watch: ['node_modules', 'data', '*.log'],
  }]
};
