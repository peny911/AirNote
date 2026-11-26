import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../context.js';
import { createRequireAuth } from '../middleware/auth.js';
import { SqliteFts5SearchService } from '../security/search-service.js';

export function createSearchRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(deps);
  const searchService = new SqliteFts5SearchService(deps.db);

  router.use('*', requireAuth);

  // GET /api/search?q=...&limit=30
  router.get('/', (c) => {
    const q = c.req.query('q') ?? '';
    const limitParam = Number(c.req.query('limit') ?? 30);
    const limit = Number.isFinite(limitParam) ? limitParam : 30;
    const results = searchService.search(c.get('user').id, q, limit);
    return c.json({ results });
  });

  return router;
}
