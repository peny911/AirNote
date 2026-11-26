import { Hono } from 'hono';
import {
  createNotebookSchema,
  createSectionSchema,
  reorderIdsSchema,
  updateNotebookSchema,
} from '../../shared/validators.js';
import { type AppDeps, type AppEnv, jsonError } from '../context.js';
import { createScopedDb } from '../db/scoped.js';
import { createRequireAuth } from '../middleware/auth.js';
import { unlinkUserAttachmentFiles } from './attachments.js';

export function createNotebookRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(deps);

  router.use('*', requireAuth);

  // GET /api/notebooks
  router.get('/', (c) => {
    const scoped = createScopedDb(deps.db, c.get('user').id);
    return c.json({ notebooks: scoped.listNotebooks() });
  });

  // POST /api/notebooks
  router.post('/', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createNotebookSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '笔记本参数不正确',
      );
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    const result = scoped.createNotebook(parsed.data);
    return c.json(result, 201);
  });

  // POST /api/notebooks/reorder
  router.post('/reorder', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = reorderIdsSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, 'VALIDATION_ERROR', '排序参数不正确');
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    scoped.reorderNotebooks(parsed.data.orderedIds);
    return c.json({ ok: true, notebooks: scoped.listNotebooks() });
  });

  // PATCH /api/notebooks/:id
  router.patch('/:id', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = updateNotebookSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '笔记本更新参数不正确',
      );
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    const updated = scoped.updateNotebook(c.req.param('id'), parsed.data);
    if (!updated) {
      return jsonError(c, 404, 'NOT_FOUND', '笔记本不存在');
    }
    return c.json({ notebook: updated });
  });

  // DELETE /api/notebooks/:id
  router.delete('/:id', (c) => {
    const userId = c.get('user').id;
    const notebookId = c.req.param('id');
    const attachmentPaths = (
      deps.db
        .prepare(
          `SELECT a.storage_path FROM attachments a
           JOIN pages p ON p.id = a.page_id
           JOIN sections s ON s.id = p.section_id
           WHERE s.notebook_id = ? AND s.user_id = ? AND a.user_id = ?`,
        )
        .all(notebookId, userId, userId) as unknown as Array<{ storage_path: string }>
    ).map((r) => r.storage_path);

    const scoped = createScopedDb(deps.db, userId);
    const deleted = scoped.deleteNotebook(notebookId);
    if (!deleted) {
      return jsonError(c, 404, 'NOT_FOUND', '笔记本不存在');
    }
    if (attachmentPaths.length > 0) {
      unlinkUserAttachmentFiles(deps.config.uploadsDir, userId, attachmentPaths);
    }
    return c.json({ ok: true });
  });

  // GET /api/notebooks/:nbId/sections
  router.get('/:nbId/sections', (c) => {
    const scoped = createScopedDb(deps.db, c.get('user').id);
    const sections = scoped.listSections(c.req.param('nbId'));
    if (!sections) {
      return jsonError(c, 404, 'NOT_FOUND', '笔记本不存在');
    }
    return c.json({ sections });
  });

  // POST /api/notebooks/:nbId/sections
  router.post('/:nbId/sections', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createSectionSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '分区参数不正确',
      );
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    const section = scoped.createSection(c.req.param('nbId'), parsed.data);
    if (!section) {
      return jsonError(c, 404, 'NOT_FOUND', '目标笔记本不存在');
    }
    return c.json({ section }, 201);
  });

  // POST /api/notebooks/:nbId/sections/reorder
  router.post('/:nbId/sections/reorder', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = reorderIdsSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, 'VALIDATION_ERROR', '排序参数不正确');
    }

    const scoped = createScopedDb(deps.db, c.get('user').id);
    const ok = scoped.reorderSections(c.req.param('nbId'), parsed.data.orderedIds);
    if (!ok) {
      return jsonError(c, 404, 'NOT_FOUND', '笔记本不存在');
    }
    return c.json({ ok: true, sections: scoped.listSections(c.req.param('nbId')) });
  });

  return router;
}
