import { Hono } from 'hono';
import {
  changePasswordSchema,
  loginSchema,
  totpConfirmSchema,
  totpDisableSchema,
  verify2faSchema,
} from '../../shared/validators.js';
import { type AppDeps, type AppEnv, type UserRow, jsonError, mapUserRow } from '../context.js';
import {
  clearSessionCookie,
  createRequireAuth,
  setSessionCookie,
} from '../middleware/auth.js';
import { writeAuditLog } from '../security/audit.js';
import {
  decryptSecret,
  encryptSecret,
  generateId,
  generateToken,
  hashToken,
} from '../security/crypto.js';
import { hashPassword, verifyPassword } from '../security/password.js';
import {
  generateRecoveryCodes,
  generateTotpSetup,
  matchRecoveryCode,
  verifyTotpCode,
} from '../security/totp.js';

const LOGIN_2FA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TOTP_SETUP_TTL_MS = 10 * 60 * 1000;

interface AuthChallengeRow {
  id: string;
  user_id: string;
  kind: 'login_2fa' | 'totp_setup';
  token_hash: string;
  payload_enc: string | null;
  expires_at: number;
  consumed_at: number | null;
}

function createSessionForUser(
  deps: AppDeps,
  userId: string,
  userAgent: string | null,
  ipAddress: string,
): string {
  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);
  const now = Date.now();
  const expiresAt = now + deps.config.sessionTtlDays * 24 * 60 * 60 * 1000;

  deps.db
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, user_agent, ip_address, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(generateId(), userId, tokenHash, userAgent, ipAddress, expiresAt, now);

  deps.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, userId);

  return rawToken;
}

export function createAuthRoutes(deps: AppDeps): Hono<AppEnv> {
  const router = new Hono<AppEnv>();
  const requireAuth = createRequireAuth(deps);

  // POST /api/auth/login
  router.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '请求参数不正确',
      );
    }

    const { username, password } = parsed.data;
    const ip = c.get('clientIp');

    const limit = deps.rateLimiter.check('login', ip, username);
    if (!limit.allowed) {
      writeAuditLog(deps.db, {
        action: 'login_rate_limited',
        targetInfo: `username=${username}`,
        ipAddress: ip,
      });
      return jsonError(
        c,
        429,
        'RATE_LIMITED',
        `登录失败次数过多，请 ${Math.ceil(limit.retryAfterSeconds / 60)} 分钟后再试`,
        { retryAfterSeconds: limit.retryAfterSeconds },
      );
    }

    const userRow = deps.db
      .prepare('SELECT * FROM users WHERE LOWER(username) = LOWER(?)')
      .get(username) as UserRow | undefined;

    if (!userRow) {
      deps.rateLimiter.recordFailure('login', ip, username);
      writeAuditLog(deps.db, {
        action: 'login_failed',
        targetInfo: `username=${username} reason=not_found`,
        ipAddress: ip,
      });
      return jsonError(c, 401, 'INVALID_CREDENTIALS', '账号或密码错误');
    }

    if (userRow.status !== 'active') {
      writeAuditLog(deps.db, {
        actorId: userRow.id,
        action: 'login_blocked_disabled',
        targetInfo: `username=${userRow.username}`,
        ipAddress: ip,
      });
      return jsonError(c, 403, 'ACCOUNT_DISABLED', '该账号已被管理员停用，请联系管理员');
    }

    const passwordValid = await verifyPassword(userRow.password_hash, password);
    if (!passwordValid) {
      deps.rateLimiter.recordFailure('login', ip, username);
      writeAuditLog(deps.db, {
        actorId: userRow.id,
        action: 'login_failed',
        targetInfo: `username=${userRow.username} reason=wrong_password`,
        ipAddress: ip,
      });
      return jsonError(c, 401, 'INVALID_CREDENTIALS', '账号或密码错误');
    }

    deps.rateLimiter.recordSuccess('login', ip, username);

    // If 2FA is enabled, issue short-lived 5-min challenge token
    if (userRow.totp_enabled === 1 && userRow.totp_secret_enc) {
      const challengeToken = generateToken(32);
      const now = Date.now();
      deps.db
        .prepare(
          `INSERT INTO auth_challenges (id, user_id, kind, token_hash, payload_enc, expires_at, created_at)
           VALUES (?, ?, 'login_2fa', ?, NULL, ?, ?)`,
        )
        .run(
          generateId(),
          userRow.id,
          hashToken(challengeToken),
          now + LOGIN_2FA_CHALLENGE_TTL_MS,
          now,
        );

      return c.json({
        status: 'requires_2fa' as const,
        challengeToken,
        expiresInSeconds: LOGIN_2FA_CHALLENGE_TTL_MS / 1000,
      });
    }

    // No 2FA -> issue session cookie directly
    const rawSession = createSessionForUser(
      deps,
      userRow.id,
      c.req.header('user-agent') ?? null,
      ip,
    );
    setSessionCookie(c, rawSession, deps.config);

    const freshUser = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userRow.id) as unknown as UserRow;

    writeAuditLog(deps.db, {
      actorId: userRow.id,
      action: 'login_success',
      targetInfo: `username=${userRow.username} method=password`,
      ipAddress: ip,
    });

    return c.json({
      status: 'authenticated' as const,
      user: mapUserRow(freshUser),
    });
  });

  // POST /api/auth/verify-2fa
  router.post('/verify-2fa', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = verify2faSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '请求参数不正确',
      );
    }

    const { challengeToken, code, isRecoveryCode } = parsed.data;
    const ip = c.get('clientIp');
    const now = Date.now();

    const challenge = deps.db
      .prepare(
        `SELECT * FROM auth_challenges
         WHERE token_hash = ? AND kind = 'login_2fa'`,
      )
      .get(hashToken(challengeToken)) as AuthChallengeRow | undefined;

    if (!challenge || challenge.consumed_at !== null || challenge.expires_at <= now) {
      return jsonError(c, 401, 'CHALLENGE_EXPIRED', '2FA 验证会话已过期，请返回重新输入密码');
    }

    const userRow = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(challenge.user_id) as UserRow | undefined;

    if (!userRow || userRow.status !== 'active') {
      return jsonError(c, 403, 'ACCOUNT_DISABLED', '账号不可用或已被停用');
    }

    if (userRow.totp_enabled !== 1 || !userRow.totp_secret_enc) {
      return jsonError(c, 400, 'TOTP_NOT_ENABLED', '该账号未启用双因素认证');
    }

    const limit = deps.rateLimiter.check('2fa', ip, userRow.username);
    if (!limit.allowed) {
      writeAuditLog(deps.db, {
        actorId: userRow.id,
        action: '2fa_rate_limited',
        targetInfo: `username=${userRow.username}`,
        ipAddress: ip,
      });
      return jsonError(
        c,
        429,
        'RATE_LIMITED',
        `2FA 验证失败次数过多，请 ${Math.ceil(limit.retryAfterSeconds / 60)} 分钟后再试`,
        { retryAfterSeconds: limit.retryAfterSeconds },
      );
    }

    let verifiedMethod: 'totp' | 'recovery_code' | null = null;

    if (isRecoveryCode) {
      const candidates = deps.db
        .prepare('SELECT id, code_hash FROM recovery_codes WHERE user_id = ? AND used_at IS NULL')
        .all(userRow.id) as Array<{ id: string; code_hash: string }>;

      const matchedId = await matchRecoveryCode(code, candidates);
      if (matchedId) {
        const res = deps.db
          .prepare('UPDATE recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL')
          .run(now, matchedId);
        if (res.changes === 1) {
          verifiedMethod = 'recovery_code';
        }
      }
    } else {
      const secretBase32 = decryptSecret(userRow.totp_secret_enc, deps.config.masterKey);
      const check = verifyTotpCode(userRow.username, secretBase32, code, userRow.totp_last_step);

      if (check.replayed) {
        deps.rateLimiter.recordFailure('2fa', ip, userRow.username);
        writeAuditLog(deps.db, {
          actorId: userRow.id,
          action: '2fa_replay_blocked',
          targetInfo: `username=${userRow.username}`,
          ipAddress: ip,
        });
        return jsonError(c, 401, 'TOTP_REPLAYED', '该验证码已使用过，请等待下一组 6 位动态码');
      }

      if (check.valid && check.step !== undefined) {
        deps.db
          .prepare('UPDATE users SET totp_last_step = ? WHERE id = ?')
          .run(check.step, userRow.id);
        verifiedMethod = 'totp';
      }
    }

    if (!verifiedMethod) {
      deps.rateLimiter.recordFailure('2fa', ip, userRow.username);
      writeAuditLog(deps.db, {
        actorId: userRow.id,
        action: '2fa_failed',
        targetInfo: `username=${userRow.username} mode=${isRecoveryCode ? 'recovery' : 'totp'}`,
        ipAddress: ip,
      });
      return jsonError(
        c,
        401,
        'INVALID_2FA_CODE',
        isRecoveryCode ? '备用恢复码无效或已被使用' : '6 位动态验证码错误，请重试',
      );
    }

    // Consume challenge token atomically
    const consumeRes = deps.db
      .prepare('UPDATE auth_challenges SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL')
      .run(now, challenge.id);
    if (consumeRes.changes !== 1) {
      return jsonError(c, 401, 'CHALLENGE_EXPIRED', '验证令牌已失效，请重新登录');
    }

    deps.rateLimiter.recordSuccess('2fa', ip, userRow.username);

    const rawSession = createSessionForUser(
      deps,
      userRow.id,
      c.req.header('user-agent') ?? null,
      ip,
    );
    setSessionCookie(c, rawSession, deps.config);

    const freshUser = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(userRow.id) as unknown as UserRow;

    writeAuditLog(deps.db, {
      actorId: userRow.id,
      action:
        verifiedMethod === 'recovery_code' ? 'login_recovery_code_success' : 'login_2fa_success',
      targetInfo: `username=${userRow.username}`,
      ipAddress: ip,
    });

    return c.json({
      status: 'authenticated' as const,
      user: mapUserRow(freshUser),
    });
  });

  // POST /api/auth/logout
  router.post('/logout', requireAuth, async (c) => {
    const user = c.get('user');
    const sessionId = c.get('sessionId');
    const ip = c.get('clientIp');

    deps.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    clearSessionCookie(c, deps.config);

    writeAuditLog(deps.db, {
      actorId: user.id,
      action: 'logout',
      targetInfo: `username=${user.username}`,
      ipAddress: ip,
    });

    return c.json({ ok: true });
  });

  // GET /api/auth/me
  router.get('/me', requireAuth, async (c) => {
    return c.json({ user: c.get('user') });
  });

  // POST /api/auth/change-password
  router.post('/change-password', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '请求参数不正确',
      );
    }

    const { currentPassword, newPassword } = parsed.data;
    if (currentPassword === newPassword) {
      return jsonError(c, 400, 'PASSWORD_UNCHANGED', '新密码不能与当前密码相同');
    }

    const user = c.get('user');
    const currentSessionId = c.get('sessionId');
    const ip = c.get('clientIp');

    const userRow = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(user.id) as UserRow | undefined;
    if (!userRow) {
      return jsonError(c, 404, 'USER_NOT_FOUND', '用户不存在');
    }

    const ok = await verifyPassword(userRow.password_hash, currentPassword);
    if (!ok) {
      return jsonError(c, 401, 'INVALID_PASSWORD', '当前密码不正确');
    }

    const newHash = await hashPassword(newPassword);
    deps.db
      .prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(newHash, user.id);

    // Revoke all other device sessions immediately
    deps.db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
      .run(user.id, currentSessionId);

    writeAuditLog(deps.db, {
      actorId: user.id,
      action: 'password_changed',
      targetInfo: `username=${user.username}`,
      ipAddress: ip,
    });

    const updated = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(user.id) as unknown as UserRow;
    return c.json({ ok: true, user: mapUserRow(updated) });
  });

  // POST /api/auth/2fa/setup
  router.post('/2fa/setup', requireAuth, async (c) => {
    const user = c.get('user');
    if (user.totpEnabled) {
      return jsonError(c, 409, 'TOTP_ALREADY_ENABLED', '双因素认证已开启，无需重复绑定');
    }

    const setup = await generateTotpSetup(user.username);
    const setupToken = generateToken(32);
    const now = Date.now();
    const secretEnc = encryptSecret(setup.secret, deps.config.masterKey);

    // Replace previous pending setup tokens for this user
    deps.db
      .prepare("DELETE FROM auth_challenges WHERE user_id = ? AND kind = 'totp_setup'")
      .run(user.id);

    deps.db
      .prepare(
        `INSERT INTO auth_challenges (id, user_id, kind, token_hash, payload_enc, expires_at, created_at)
         VALUES (?, ?, 'totp_setup', ?, ?, ?, ?)`,
      )
      .run(
        generateId(),
        user.id,
        hashToken(setupToken),
        secretEnc,
        now + TOTP_SETUP_TTL_MS,
        now,
      );

    return c.json({
      setupToken,
      secret: setup.secret,
      secretFormatted: setup.secretFormatted,
      otpauthUri: setup.otpauthUri,
      qrCodeDataUrl: setup.qrCodeDataUrl,
      expiresInSeconds: TOTP_SETUP_TTL_MS / 1000,
    });
  });

  // POST /api/auth/2fa/confirm
  router.post('/2fa/confirm', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = totpConfirmSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '请输入 6 位数字验证码',
      );
    }

    const user = c.get('user');
    const ip = c.get('clientIp');
    const now = Date.now();

    if (user.totpEnabled) {
      return jsonError(c, 409, 'TOTP_ALREADY_ENABLED', '双因素认证已处于开启状态');
    }

    const challenge = deps.db
      .prepare(
        `SELECT * FROM auth_challenges
         WHERE token_hash = ? AND user_id = ? AND kind = 'totp_setup'`,
      )
      .get(hashToken(parsed.data.setupToken), user.id) as AuthChallengeRow | undefined;

    if (
      !challenge ||
      challenge.consumed_at !== null ||
      challenge.expires_at <= now ||
      !challenge.payload_enc
    ) {
      return jsonError(c, 400, 'SETUP_EXPIRED', '2FA 绑定会话已过期，请重新生成密钥');
    }

    const secretBase32 = decryptSecret(challenge.payload_enc, deps.config.masterKey);
    const check = verifyTotpCode(user.username, secretBase32, parsed.data.code, null);
    if (!check.valid || check.step === undefined) {
      return jsonError(c, 400, 'INVALID_TOTP_CODE', '6 位动态验证码不正确，请核对手机时间后重试');
    }

    const { rawCodes, hashedCodes } = await generateRecoveryCodes(8);

    deps.db.exec('BEGIN');
    try {
      deps.db
        .prepare(
          `UPDATE users
           SET totp_secret_enc = ?, totp_enabled = 1, totp_last_step = ?
           WHERE id = ?`,
        )
        .run(challenge.payload_enc, check.step, user.id);

      deps.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
      const insertCode = deps.db.prepare(
        'INSERT INTO recovery_codes (id, user_id, code_hash, used_at) VALUES (?, ?, ?, NULL)',
      );
      for (const codeHash of hashedCodes) {
        insertCode.run(generateId(), user.id, codeHash);
      }

      deps.db
        .prepare('UPDATE auth_challenges SET consumed_at = ? WHERE id = ?')
        .run(now, challenge.id);

      deps.db.exec('COMMIT');
    } catch (err) {
      deps.db.exec('ROLLBACK');
      throw err;
    }

    writeAuditLog(deps.db, {
      actorId: user.id,
      action: '2fa_enabled',
      targetInfo: `username=${user.username}`,
      ipAddress: ip,
    });

    return c.json({
      enabled: true as const,
      recoveryCodes: rawCodes,
    });
  });

  // POST /api/auth/2fa/disable
  router.post('/2fa/disable', requireAuth, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = totpDisableSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(
        c,
        400,
        'VALIDATION_ERROR',
        parsed.error.issues[0]?.message || '请提供当前密码或 6 位动态验证码',
      );
    }

    const user = c.get('user');
    const ip = c.get('clientIp');

    const userRow = deps.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(user.id) as UserRow | undefined;

    if (!userRow || userRow.totp_enabled !== 1) {
      return jsonError(c, 400, 'TOTP_NOT_ENABLED', '当前账号未开启双因素认证');
    }

    let verified = false;
    if (parsed.data.currentPassword) {
      verified = await verifyPassword(userRow.password_hash, parsed.data.currentPassword);
    } else if (parsed.data.totpCode && userRow.totp_secret_enc) {
      const secretBase32 = decryptSecret(userRow.totp_secret_enc, deps.config.masterKey);
      const check = verifyTotpCode(
        userRow.username,
        secretBase32,
        parsed.data.totpCode,
        userRow.totp_last_step,
      );
      verified = check.valid;
    }

    if (!verified) {
      return jsonError(c, 401, 'VERIFICATION_FAILED', '身份验证未通过，无法关闭 2FA');
    }

    deps.db.exec('BEGIN');
    try {
      deps.db
        .prepare(
          'UPDATE users SET totp_enabled = 0, totp_secret_enc = NULL, totp_last_step = NULL WHERE id = ?',
        )
        .run(user.id);
      deps.db.prepare('DELETE FROM recovery_codes WHERE user_id = ?').run(user.id);
      deps.db
        .prepare("DELETE FROM auth_challenges WHERE user_id = ? AND kind = 'totp_setup'")
        .run(user.id);
      deps.db.exec('COMMIT');
    } catch (err) {
      deps.db.exec('ROLLBACK');
      throw err;
    }

    writeAuditLog(deps.db, {
      actorId: user.id,
      action: '2fa_disabled',
      targetInfo: `username=${user.username}`,
      ipAddress: ip,
    });

    return c.json({ enabled: false as const });
  });

  return router;
}
