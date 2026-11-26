import { Hono } from 'hono';
import {
  createPageSchema,
  reorderIdsSchema,
  updateSectionSchema,
} from '../../shared/validators.js';
import { type AppDeps, type AppEnv, jsonError } from '../context.js';
import { createScopedDb } from '../db/scoped.js';
import { createRequireAuth } from '../middleware/auth.js';
import { unlinkUserAttachmentFiles } from './attachments.js';

export function createSectionRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(deps);

  router.use('*', requireAuth);

  // GET /api/sections (all sections owned by current user, useful for cross-section move picker)
  router.get('/', (c) => {
    const scoped = createScopedDb(deps.db, c.get('user').id);
    return c.json({ sections: scoped.listAllSections() });
  });

  // PATCH /api/sections/:id
  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateSectionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '分区更新参数不正确',
      );
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    const updated = scoped.updateSection(c.req.param('id'), parsed.data);
    if (!updated) {
      return jsonError(c, 404, 'NOT_FOUND', '分区或目标笔记本不存在');
    }
    return c.json({ section: updated });
  });

  // DELETE /api/sections/:id
  router.delete('/:id', (c) => {
    const userId = c.get('user').id;
    const sectionId = c.req.param('id');
    const attachmentPaths = (
      deps.db
        .prepare(
          `SELECT a.storage_path FROM attachments a
           JOIN pages p ON p.id = a.page_id
           WHERE p.section_id = ? AND p.user_id = ? AND a.user_id = ?`,
        )
        .all(sectionId, userId, userId) as unknown as Array<{ storage_path: string }>
    ).map((r) => r.storage_path);

    const scoped = createScopedDb(deps.db, userId);
    const deleted = scoped.deleteSection(sectionId);
    if (!deleted) {
      return jsonError(c, 404, 'NOT_FOUND', '分区不存在');
    }
    if (attachmentPaths.length > 0) {
      unlinkUserAttachmentFiles(deps.config.uploadsDir, userId, attachmentPaths);
    }
    return c.json({ ok: true });
  });

  // GET /api/sections/:secId/pages
  router.get('/:secId/pages', (c) => {
    const scoped = createScopedDb(deps.db, c.get('user').id);
    const pages = scoped.listPages(c.req.param('secId'));
    if (!pages) {
      return jsonError(c, 404, 'NOT_FOUND', '分区不存在');
    }
    return c.json({ pages });
  });

  // POST /api/sections/:secId/pages
  router.post('/:secId/pages', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const parsed = createPageSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '页面参数不正确',
      );
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    const page = scoped.createPage(c.req.param('secId'), parsed.data);
    if (!page) {
      return jsonError(c, 404, 'NOT_FOUND', '目标分区或父页面不存在');
    }
    return c.json({ page }, 201);
  });

  // POST /api/sections/:secId/pages/reorder
  router.post('/:secId/pages/reorder', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = reorderIdsSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, 'VALIDATION_ERROR', '排序参数不正确');
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    const ok = scoped.reorderPages(c.req.param('secId'), parsed.data.orderedIds);
    if (!ok) {
      return jsonError(c, 404, 'NOT_FOUND', '分区不存在');
    }
    return c.json({ ok: true, pages: scoped.listPages(c.req.param('secId')) });
  });

  return router;
}
