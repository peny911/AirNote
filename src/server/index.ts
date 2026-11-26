import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { initDatabase, purgeExpiredAuthState } from './db/client.js';
import { DualDimensionRateLimiter } from './security/rate-limit.js';

const config = loadConfig();
const db = initDatabase(config.dbPath, config.uploadsDir);
const rateLimiter = new DualDimensionRateLimiter();

// Initial & hourly expired session/challenge cleanup
purgeExpiredAuthState(db);
const cleanupTimer = setInterval(() => {
  try {
    purgeExpiredAuthState(db);
  } catch (err) {
    console.error('[AirNote] Cleanup error:', err);
  }
}, 60 * 60 * 1000);
cleanupTimer.unref();

const app = createApp({ db, config, rateLimiter });

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(
      `✦ AirNote server listening on http://${info.address}:${info.port} (${config.nodeEnv})`,
    );
  },
);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `✖ 端口 ${config.host}:${config.port} 已被占用，请关闭占用进程或通过 PORT 环境变量更换端口。`,
    );
  } else {
    console.error('✖ AirNote 服务启动失败：', err);
  }
  clearInterval(cleanupTimer);
  db.close();
  process.exit(1);
});

function shutdown() {
  clearInterval(cleanupTimer);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
