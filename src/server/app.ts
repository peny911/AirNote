import fs from 'node:fs';
import path from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { type AppDeps, type AppEnv, jsonError } from './context.js';
import { createCsrfMiddleware, createSecurityHeadersMiddleware } from './middleware/auth.js';
import { createAdminRoutes } from './routes/admin.js';
import { createAttachmentRoutes } from './routes/attachments.js';
import { createAuthRoutes } from './routes/auth.js';
import { createNotebookRoutes } from './routes/notebooks.js';
import { createPageRoutes } from './routes/pages.js';
import { createSearchRoutes } from './routes/search.js';
import { createSectionRoutes } from './routes/sections.js';

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', createSecurityHeadersMiddleware(deps));
  app.use('/api/*', createCsrfMiddleware(deps));

  app.get('/api/health', (c) => c.json({ ok: true, service: 'AirNote', timestamp: Date.now() }));

  app.route('/api/auth', createAuthRoutes(deps));
  app.route('/api/admin', createAdminRoutes(deps));
  app.route('/api/notebooks', createNotebookRoutes(deps));
  app.route('/api/sections', createSectionRoutes(deps));
  app.route('/api/pages', createPageRoutes(deps));
  app.route('/api/search', createSearchRoutes(deps));
  app.route('/api/attachments', createAttachmentRoutes(deps));

  app.all('/api/*', (c) => jsonError(c, 404, 'NOT_FOUND', '请求的 API 接口不存在'));

  app.onError((err, c) => {
    console.error('[AirNote Error]', err);
    return jsonError(c, 500, 'INTERNAL_ERROR', '服务器内部错误，请稍后重试');
  });

  // Production static asset hosting (single-process mode)
  const clientDistDir = path.resolve(process.cwd(), 'dist/client');
  if (fs.existsSync(clientDistDir)) {
    app.use('/*', serveStatic({ root: './dist/client' }));
    app.get('*', (c) => {
      const indexHtml = fs.readFileSync(path.join(clientDistDir, 'index.html'), 'utf8');
      return c.html(indexHtml);
    });
  }

  return app;
}
