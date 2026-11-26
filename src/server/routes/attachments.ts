import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { AttachmentItem } from '../../shared/types.js';
import { type AppDeps, type AppEnv, jsonError } from '../context.js';
import { createScopedDb, ensureUserUploadDir } from '../db/scoped.js';
import { createRequireAuth } from '../middleware/auth.js';
import { generateId } from '../security/crypto.js';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB per file

const INLINE_SAFE_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
]);

interface AttachmentRow {
  id: string;
  user_id: string;
  page_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: number;
}

function sanitizeFilename(raw: string): string {
  const base = path.basename(raw || 'attachment').replace(/[\r\n"\\]/g, '_').trim();
  return base.slice(0, 180) || 'attachment';
}

function safeExtension(filename: string, mimeType: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (/^\.[a-z0-9]{1,10}$/.test(ext)) return ext;
  const mimeMap: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'application/pdf': '.pdf',
    'text/plain': '.txt',
  };
  return mimeMap[mimeType] ?? '';
}

function mapAttachmentRow(row: AttachmentRow): AttachmentItem {
  return {
    id: row.id,
    pageId: row.page_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    url: `/api/attachments/${row.id}`,
    createdAt: row.created_at,
  };
}

/**
 * 隔离附件路由：
 * - 物理分目录存储于 data/uploads/<user_id>/<uuid><ext>
 * - 严禁公开静态暴露，下载/预览均强校验 attachment.user_id === session.userId
 * - 非安全光栅图片（如 SVG/HTML/PDF/文档）一律强制 Content-Disposition: attachment 防止 XSS
 */
export function createAttachmentRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(deps);

  router.use('*', requireAuth);

  // GET /api/attachments/:id
  router.get('/:id', (c) => {
    const userId = c.get('user').id;
    const attachmentId = c.req.param('id');
    const row = deps.db
      .prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?')
      .get(attachmentId, userId) as unknown as AttachmentRow | undefined;

    if (!row) {
      return jsonError(c, 404, 'NOT_FOUND', '附件不存在');
    }

    const userDir = path.resolve(deps.config.uploadsDir, path.basename(userId));
    const resolvedPath = path.resolve(deps.config.uploadsDir, row.storage_path);
    if (!resolvedPath.startsWith(`${userDir}${path.sep}`) || !fs.existsSync(resolvedPath)) {
      return jsonError(c, 404, 'FILE_MISSING', '附件文件不存在');
    }

    const fileBytes = fs.readFileSync(resolvedPath);
    const forceDownload = c.req.query('download') === '1';
    const canInline = !forceDownload && INLINE_SAFE_IMAGE_MIMES.has(row.mime_type);
    const encodedName = encodeURIComponent(row.filename);
    const disposition = canInline
      ? `inline; filename*=UTF-8''${encodedName}`
      : `attachment; filename*=UTF-8''${encodedName}`;

    return new Response(fileBytes, {
      status: 200,
      headers: {
        'Content-Type': canInline ? row.mime_type : 'application/octet-stream',
        'Content-Length': String(fileBytes.byteLength),
        'Content-Disposition': disposition,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  });

  // DELETE /api/attachments/:id
  router.delete('/:id', (c) => {
    const userId = c.get('user').id;
    const attachmentId = c.req.param('id');
    const row = deps.db
      .prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?')
      .get(attachmentId, userId) as unknown as AttachmentRow | undefined;

    if (!row) {
      return jsonError(c, 404, 'NOT_FOUND', '附件不存在');
    }

    deps.db
      .prepare('DELETE FROM attachments WHERE id = ? AND user_id = ?')
      .run(attachmentId, userId);

    const userDir = path.resolve(deps.config.uploadsDir, path.basename(userId));
    const resolvedPath = path.resolve(deps.config.uploadsDir, row.storage_path);
    if (resolvedPath.startsWith(`${userDir}${path.sep}`) && fs.existsSync(resolvedPath)) {
      try {
        fs.unlinkSync(resolvedPath);
      } catch {
        // Ignore filesystem race if already removed
      }
    }

    return c.json({ ok: true });
  });

  return router;
}

export function unlinkUserAttachmentFiles(
  uploadsDir: string,
  userId: string,
  storagePaths: string[],
): void {
  const userDir = path.resolve(uploadsDir, path.basename(userId));
  for (const rel of storagePaths) {
    const full = path.resolve(uploadsDir, rel);
    if (full.startsWith(`${userDir}${path.sep}`) && fs.existsSync(full)) {
      try {
        fs.unlinkSync(full);
      } catch {
        // Ignore filesystem race if already removed
      }
    }
  }
}

export function attachPageAttachmentRoutes(router: Hono<AppEnv>, deps: AppDeps): void {
  // GET /api/pages/:pageId/attachments
  router.get('/:pageId/attachments', (c) => {
    const userId = c.get('user').id;
    const pageId = c.req.param('pageId');
    const scoped = createScopedDb(deps.db, userId);
    if (!scoped.getPage(pageId)) {
      return jsonError(c, 404, 'NOT_FOUND', '页面不存在');
    }

    const rows = deps.db
      .prepare(
        'SELECT * FROM attachments WHERE page_id = ? AND user_id = ? ORDER BY created_at DESC',
      )
      .all(pageId, userId) as unknown as AttachmentRow[];

    return c.json({ attachments: rows.map(mapAttachmentRow) });
  });

  // POST /api/pages/:pageId/attachments
  router.post('/:pageId/attachments', async (c) => {
    const userId = c.get('user').id;
    const pageId = c.req.param('pageId');
    const scoped = createScopedDb(deps.db, userId);
    if (!scoped.getPage(pageId)) {
      return jsonError(c, 404, 'NOT_FOUND', '目标页面不存在');
    }

    const formData = await c.req.formData().catch(() => null);
    if (!formData) {
      return jsonError(c, 400, 'INVALID_MULTIPART', '请使用 multipart/form-data 上传文件');
    }

    const fileEntry = formData.get('file');
    if (!(fileEntry instanceof File)) {
      return jsonError(c, 400, 'FILE_REQUIRED', '未找到上传的文件字段 file');
    }

    if (fileEntry.size === 0) {
      return jsonError(c, 400, 'FILE_EMPTY', '不能上传空文件');
    }

    if (fileEntry.size > MAX_ATTACHMENT_BYTES) {
      return jsonError(c, 413, 'FILE_TOO_LARGE', '单个附件大小不能超过 20 MB');
    }

    const id = generateId();
    const filename = sanitizeFilename(fileEntry.name);
    const mimeType = (fileEntry.type || 'application/octet-stream').toLowerCase();
    const ext = safeExtension(filename, mimeType);
    const safeUserId = path.basename(userId);
    const userUploadDir = ensureUserUploadDir(deps.config.uploadsDir, safeUserId);
    const diskFilename = `${id}${ext}`;
    const fullDiskPath = path.join(userUploadDir, diskFilename);
    const relativeStoragePath = path.join(safeUserId, diskFilename);

    const bytes = Buffer.from(await fileEntry.arrayBuffer());
    fs.writeFileSync(fullDiskPath, bytes, { mode: 0o600 });

    const now = Date.now();
    deps.db
      .prepare(
        `INSERT INTO attachments (id, user_id, page_id, filename, mime_type, size_bytes, storage_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, pageId, filename, mimeType, bytes.byteLength, relativeStoragePath, now);

    const attachment: AttachmentItem = {
      id,
      pageId,
      filename,
      mimeType,
      sizeBytes: bytes.byteLength,
      url: `/api/attachments/${id}`,
      createdAt: now,
    };

    return c.json({ attachment }, 201);
  });
}
