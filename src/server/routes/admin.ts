import { Hono } from 'hono';
import type { AuditLogItem } from '../../shared/types.js';
import {
  adminCreateUserSchema,
  adminUpdateStatusSchema,
  auditLogsQuerySchema,
} from '../../shared/validators.js';
import { type AppDeps, type AppEnv, type UserRow, jsonError, mapUserRow } from '../context.js';
import { requireAdmin } from '../middleware/admin.js';
import { createRequireAuth } from '../middleware/auth.js';
import { writeAuditLog } from '../security/audit.js';
import { generateId } from '../security/crypto.js';
import { generateTemporaryPassword, hashPassword } from '../security/password.js';

interface AuditJoinRow {
  id: string;
  actor_id: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  action: string;
  target_info: string | null;
  ip_address: string | null;
  created_at: number;
}

/**
 * 管理员成员控制台路由：
 * 严格限定仅管理成员账号生命周期与安全审计日志，不提供任何读取、统计或访问他人笔记的接口。
 */
export function createAdminRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(deps);

  router.use('*', requireAuth, requireAdmin);

  // GET /api/admin/users
  router.get('/users', async (c) => {
    const rows = deps.db
      .prepare(
        `SELECT id, username, display_name, password_hash, role, status,
                totp_secret_enc, totp_enabled, totp_last_step, must_change_password,
                created_at, last_login_at
         FROM users
         ORDER BY created_at ASC`,
      )
      .all() as unknown as UserRow[];

    return c.json({
      users: rows.map(mapUserRow),
    });
  });

  // POST /api/admin/users
  router.post('/users', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = adminCreateUserSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '用户信息格式不正确',
      );
    }

    const { username, displayName, role } = parsed.data;
    const existing = deps.db
      .prepare('SELECT id FROM users WHERE LOWER(username) = LOWER(?)')
      .get(username);
    if (existing) {
      return jsonError(c, 409, 'USERNAME_EXISTS', '该登录账号已存在');
    }

    const temporaryPassword = generateTemporaryPassword(16);
    const passwordHash = await hashPassword(temporaryPassword);
    const id = generateId();
    const now = Date.now();

    deps.db
      .prepare(
        `INSERT INTO users (
           id, username, display_name, password_hash, role, status,
           totp_enabled, must_change_password, created_at
         ) VALUES (?, ?, ?, ?, ?, 'active', 0, 1, ?)`,
      )
      .run(id, username, displayName, passwordHash, role, now);

    const admin = c.get('user');
    writeAuditLog(deps.db, {
      actorId: admin.id,
      action: 'admin_create_user',
      targetInfo: `userId=${id} username=${username} role=${role}`,
      ipAddress: c.get('clientIp'),
    });

    const created = deps.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRow;
    return c.json(
      {
        user: mapUserRow(created),
        temporaryPassword,
      },
      201,
    );
  });

  // PATCH /api/admin/users/:id/status
  router.patch('/users/:id/status', async (c) => {
    const targetId = c.req.param('id');
    const body = await c.req.json().catch(() => null);
    const parsed = adminUpdateStatusSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(c, 400, 'VALIDATION_ERROR', '无效的账号状态');
    }

    const admin = c.get('user');
    if (targetId === admin.id && parsed.data.status === 'disabled') {
      return jsonError(c, 400, 'CANNOT_DISABLE_SELF', '不能停用当前登录的管理员自身账号');
    }

    const target = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(targetId) as unknown as UserRow | undefined;
    if (!target) {
      return jsonError(c, 404, 'USER_NOT_FOUND', '目标成员不存在');
    }

    deps.db.exec('BEGIN');
    try {
      deps.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(parsed.data.status, targetId);
      if (parsed.data.status === 'disabled') {
        // Immediately revoke all active sessions and pending login challenges
        deps.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
        deps.db.prepare('DELETE FROM auth_challenges WHERE user_id = ?').run(targetId);
      }
      deps.db.exec('COMMIT');
    } catch (err) {
      deps.db.exec('ROLLBACK');
      throw err;
    }

    writeAuditLog(deps.db, {
      actorId: admin.id,
      action: parsed.data.status === 'disabled' ? 'admin_disable_user' : 'admin_enable_user',
      targetInfo: `userId=${targetId} username=${target.username}`,
      ipAddress: c.get('clientIp'),
    });

    const updated = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(targetId) as unknown as UserRow;
    return c.json({ user: mapUserRow(updated) });
  });

  // POST /api/admin/users/:id/reset-password
  router.post('/users/:id/reset-password', async (c) => {
    const targetId = c.req.param('id');
    const target = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(targetId) as unknown as UserRow | undefined;
    if (!target) {
      return jsonError(c, 404, 'USER_NOT_FOUND', '目标成员不存在');
    }

    const temporaryPassword = generateTemporaryPassword(16);
    const passwordHash = await hashPassword(temporaryPassword);

    deps.db.exec('BEGIN');
    try {
      deps.db
        .prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
        .run(passwordHash, targetId);
      deps.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId);
      deps.db.prepare('DELETE FROM auth_challenges WHERE user_id = ?').run(targetId);
      deps.db.exec('COMMIT');
    } catch (err) {
      deps.db.exec('ROLLBACK');
      throw err;
    }

    const admin = c.get('user');
    writeAuditLog(deps.db, {
      actorId: admin.id,
      action: 'admin_reset_password',
      targetInfo: `userId=${targetId} username=${target.username}`,
      ipAddress: c.get('clientIp'),
    });

    return c.json({ temporaryPassword });
  });

  // POST /api/admin/users/:id/reset-2fa
  router.post('/users/:id/reset-2fa', async (c) => {
    const targetId = c.req.param('id');
    const target = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(targetId) as unknown as UserRow | undefined;
    if (!target) {
      return jsonError(c, 404, 'USER_NOT_FOUND', '目标成员不存在');
    }

    deps.db.exec('BEGIN');
    try {
      deps.db
        .prepare(
          'UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = ?',
        )
        .run(targetId);
      deps.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(targetId);
      deps.db.prepare('DELETE FROM auth_challenges WHERE user_id = ?').run(targetId);
      deps.db.exec('COMMIT');
    } catch (err) {
      deps.db.exec('ROLLBACK');
      throw err;
    }

    const admin = c.get('user');
    writeAuditLog(deps.db, {
      actorId: admin.id,
      action: 'admin_reset_2fa',
      targetInfo: `userId=${targetId} username=${target.username}`,
      ipAddress: c.get('clientIp'),
    });

    const updated = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(targetId) as unknown as UserRow;
    return c.json({ user: mapUserRow(updated) });
  });

  // GET /api/admin/audit-logs
  router.get('/audit-logs', async (c) => {
    const parsed = auditLogsQuerySchema.safeParse({
      page: c.req.query('page'),
      pageSize: c.req.query('pageSize'),
      action: c.req.query('action') || undefined,
    });
    if (!parsed.success) {
      return jsonError(c, 400, 'VALIDATION_ERROR', '分页参数不正确');
    }

    const { page, pageSize, action } = parsed.data;
    const offset = (page - 1) * pageSize;

    const whereClause = action ? 'WHERE l.action = ?' : '';
    const countRow = (
      action
        ? deps.db.prepare(`SELECT COUNT(*) AS cnt FROM audit_logs l ${whereClause}`).get(action)
        : deps.db.prepare('SELECT COUNT(*) AS cnt FROM audit_logs').get()
    ) as { cnt: number };

    const sql = `
      SELECT l.id, l.actor_id, u.username AS actor_username, u.display_name AS actor_display_name,
             l.action, l.target_info, l.ip_address, l.created_at
      FROM audit_logs l
      LEFT JOIN users u ON u.id = l.actor_id
      ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = (
      action
        ? deps.db.prepare(sql).all(action, pageSize, offset)
        : deps.db.prepare(sql).all(pageSize, offset)
    ) as unknown as AuditJoinRow[];

    const items: AuditLogItem[] = rows.map((r) => ({
      id: r.id,
      actorId: r.actor_id,
      actorUsername: r.actor_username,
      actorDisplayName: r.actor_display_name,
      action: r.action,
      targetInfo: r.target_info,
      ipAddress: r.ip_address,
      createdAt: r.created_at,
    }));

    return c.json({
      items,
      total: countRow.cnt,
      page,
      pageSize,
    });
  });

  return router;
}
