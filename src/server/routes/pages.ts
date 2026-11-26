import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import { updatePageSchema } from '../../shared/validators.js';
import { type AppDeps, type AppEnv, jsonError } from '../context.js';
import { createScopedDb } from '../db/scoped.js';
import { createRequireAuth } from '../middleware/auth.js';
import { attachPageAttachmentRoutes } from './attachments.js';

function unlinkAttachmentFiles(uploadsDir: string, userId: string, storagePaths: string[]): void {
  const userDir = path.resolve(uploadsDir, path.basename(userId));
  for (const rel of storagePaths) {
    const full = path.resolve(uploadsDir, rel);
    if (full.startsWith(`${userDir}${path.sep}`) && fs.existsSync(full)) {
      try {
        fs.unlinkSync(full);
      } catch {
        // ignore missing file
      }
    }
  }
}

export function createPageRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(deps);

  router.use('*', requireAuth);
  attachPageAttachmentRoutes(router, deps);

  // GET /api/pages/pinned
  router.get('/pinned', (c) => {
    const scoped = createScopedDb(deps.db, c.get('user').id);
    return c.json({ pages: scoped.listPinnedPages() });
  });

  // GET /api/pages/trash
  router.get('/trash', (c) => {
    const scoped = createScopedDb(deps.db, c.get('user').id);
    return c.json({ pages: scoped.listTrashPages() });
  });

  // DELETE /api/pages/trash/empty
  router.delete('/trash/empty', (c) => {
    const userId = c.get('user').id;
    const attachmentPaths = (
      deps.db
        .prepare(
          `SELECT a.storage_path FROM attachments a
           JOIN pages p ON p.id = a.page_id
           WHERE p.user_id = ? AND p.is_deleted = 1 AND a.user_id = ?`,
        )
        .all(userId, userId) as unknown as Array<{ storage_path: string }>
    ).map((r) => r.storage_path);

    const scoped = createScopedDb(deps.db, userId);
    const deletedCount = scoped.emptyTrash();
    unlinkAttachmentFiles(deps.config.uploadsDir, userId, attachmentPaths);
    return c.json({ ok: true, deletedCount });
  });

  // GET /api/pages/quick-search?q=...
  router.get('/quick-search', (c) => {
    const q = c.req.query('q') ?? '';
    const scoped = createScopedDb(deps.db, c.get('user').id);
    return c.json({ pages: scoped.searchPagesQuick(q, 30) });
  });

  // GET /api/pages/:id
  router.get('/:id', (c) => {
    const scoped = createScopedDb(deps.db, c.get('user').id);
    const page = scoped.getPage(c.req.param('id'));
    if (!page) {
      return jsonError(c, 404, 'NOT_FOUND', '页面不存在');
    }
    return c.json({ page });
  });

  // PATCH /api/pages/:id
  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updatePageSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '页面更新参数不正确',
      );
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    const updated = scoped.updatePage(c.req.param('id'), parsed.data);
    if (!updated) {
      return jsonError(c, 404, 'NOT_FOUND', '页面、目标分区或父页面不存在');
    }
    return c.json({ page: updated });
  });

  // DELETE /api/pages/:id (?permanent=true for hard delete from trash)
  router.delete('/:id', (c) => {
    const userId = c.get('user').id;
    const pageId = c.req.param('id');
    const permanent = c.req.query('permanent') === 'true';

    const attachmentPaths = permanent
      ? (
          deps.db
            .prepare('SELECT storage_path FROM attachments WHERE page_id = ? AND user_id = ?')
            .all(pageId, userId) as unknown as Array<{ storage_path: string }>
        ).map((r) => r.storage_path)
      : [];

    const scoped = createScopedDb(deps.db, userId);
    const deleted = scoped.deletePage(pageId, permanent);
    if (!deleted) {
      return jsonError(c, 404, 'NOT_FOUND', '页面不存在');
    }
    if (permanent && attachmentPaths.length > 0) {
      unlinkAttachmentFiles(deps.config.uploadsDir, userId, attachmentPaths);
    }
    return c.json({ ok: true, permanent });
  });

  return router;
}
