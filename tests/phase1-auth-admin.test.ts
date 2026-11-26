import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import * as OTPAuth from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { initDatabase } from '../src/server/db/client.js';
import { createScopedDb } from '../src/server/db/scoped.js';
import { generateId } from '../src/server/security/crypto.js';
import { hashPassword } from '../src/server/security/password.js';
import { DualDimensionRateLimiter } from '../src/server/security/rate-limit.js';
import { verifyTotpCode } from '../src/server/security/totp.js';

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/airnote_session=([^;]+)/);
  if (!match) {
    throw new Error(`Expected airnote_session cookie, got: ${setCookie}`);
  }
  return `airnote_session=${match[1]}`;
}

function generateCurrentTotp(username: string, secretBase32: string, timestamp?: number): string {
  const totp = new OTPAuth.TOTP({
    issuer: 'AirNote',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
  return totp.generate({ timestamp });
}

describe('AirNote Phase 1 — Auth, 2FA, Rate Limit & Admin Console', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof createApp>;
  let rateLimiter: DualDimensionRateLimiter;

  async function seedUser(opts: {
    username: string;
    displayName: string;
    password: string;
    role: 'admin' | 'user';
    mustChangePassword?: boolean;
  }) {
    const id = generateId();
    const hash = await hashPassword(opts.password);
    db.prepare(
      `INSERT INTO users (
         id, username, display_name, password_hash, role, status,
         totp_enabled, must_change_password, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`,
    ).run(
      id,
      opts.username,
      opts.displayName,
      hash,
      opts.role,
      opts.mustChangePassword ? 1 : 0,
      Date.now(),
    );
    return id;
  }

  beforeEach(async () => {
    db = initDatabase(':memory:');
    rateLimiter = new DualDimensionRateLimiter({ maxFailures: 5, lockoutMs: 60_000 });
    const config = loadConfig({
      dbPath: ':memory:',
      nodeEnv: 'test',
      masterKey: crypto.randomBytes(32),
      cookieSecure: false,
    });
    app = createApp({ db, config, rateLimiter });

    await seedUser({
      username: 'admin@airnote.local',
      displayName: '超级管理员',
      password: 'AdminPassword!123',
      role: 'admin',
      mustChangePassword: false,
    });
  });

  afterEach(() => {
    db.close();
  });

  it('rejects unauthenticated requests and enforces CSRF Origin checks', async () => {
    const meRes = await app.request('/api/auth/me');
    expect(meRes.status).toBe(401);

    const adminRes = await app.request('/api/admin/users');
    expect(adminRes.status).toBe(401);

    const csrfRes = await app.request('http://localhost:3000/api/auth/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        host: 'localhost:3000',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    expect(csrfRes.status).toBe(403);
  });

  it('handles password login, multi-session revocation on password change, and logout', async () => {
    // Login session 1
    const login1 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    expect(login1.status).toBe(200);
    const body1 = await login1.json();
    expect(body1.status).toBe('authenticated');
    expect(body1.user.role).toBe('admin');
    const cookie1 = extractSessionCookie(login1);

    // Login session 2 (another device)
    const login2 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    const cookie2 = extractSessionCookie(login2);

    // Change password from session 1 -> revokes session 2, keeps session 1
    const changeRes = await app.request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookie1 },
      body: JSON.stringify({
        currentPassword: 'AdminPassword!123',
        newPassword: 'NewStrongPassword!456',
      }),
    });
    expect(changeRes.status).toBe(200);

    const me1 = await app.request('/api/auth/me', { headers: { cookie: cookie1 } });
    expect(me1.status).toBe(200);

    const me2 = await app.request('/api/auth/me', { headers: { cookie: cookie2 } });
    expect(me2.status).toBe(401);

    // Logout session 1
    const logoutRes = await app.request('/api/auth/logout', {
      method: 'POST',
      headers: { cookie: cookie1 },
    });
    expect(logoutRes.status).toBe(200);

    const meAfterLogout = await app.request('/api/auth/me', { headers: { cookie: cookie1 } });
    expect(meAfterLogout.status).toBe(401);
  });

  it('enforces dual-dimension rate limiting after 5 consecutive failed logins', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-client-ip': '10.0.0.99' },
        body: JSON.stringify({ username: 'admin@airnote.local', password: 'wrong-password' }),
      });
      expect(res.status).toBe(401);
    }

    const lockedRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-client-ip': '10.0.0.99' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    expect(lockedRes.status).toBe(429);
    const lockedJson = await lockedRes.json();
    expect(lockedJson.error.code).toBe('RATE_LIMITED');
  });

  it('completes optional 2FA setup, replay protection, recovery code single-use, and disable flow', async () => {
    const loginRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    const cookie = extractSessionCookie(loginRes);

    // Step 1: Setup 2FA
    const setupRes = await app.request('/api/auth/2fa/setup', {
      method: 'POST',
      headers: { cookie },
    });
    expect(setupRes.status).toBe(200);
    const setup = await setupRes.json();
    expect(setup.secret).toBeTruthy();
    expect(setup.otpauthUri).toContain('otpauth://totp/');
    expect(setup.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);

    // Step 2: Confirm with valid TOTP code
    const code = generateCurrentTotp('admin@airnote.local', setup.secret);
    const confirmRes = await app.request('/api/auth/2fa/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ setupToken: setup.setupToken, code }),
    });
    expect(confirmRes.status).toBe(200);
    const confirmJson = await confirmRes.json();
    expect(confirmJson.enabled).toBe(true);
    expect(confirmJson.recoveryCodes).toHaveLength(8);

    // Verify replay protection directly at utility level
    const nowStep = Math.floor(Date.now() / 1000 / 30);
    const replayCheck = verifyTotpCode('admin@airnote.local', setup.secret, code, nowStep);
    expect(replayCheck.valid).toBe(false);
    expect(replayCheck.replayed).toBe(true);

    // Step 3: Next login requires 2FA
    const login2 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    expect(login2.status).toBe(200);
    const login2Json = await login2.json();
    expect(login2Json.status).toBe('requires_2fa');
    expect(login2Json.challengeToken).toBeTruthy();

    // Replaying the same TOTP code used during confirm within same 30s window is blocked
    const replayRes = await app.request('/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeToken: login2Json.challengeToken,
        code,
        isRecoveryCode: false,
      }),
    });
    expect(replayRes.status).toBe(401);
    expect((await replayRes.json()).error.code).toBe('TOTP_REPLAYED');

    // Step 4: Verify using one-time recovery code succeeds
    const recoveryCode = confirmJson.recoveryCodes[0];
    const recRes = await app.request('/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeToken: login2Json.challengeToken,
        code: recoveryCode,
        isRecoveryCode: true,
      }),
    });
    expect(recRes.status).toBe(200);
    const recCookie = extractSessionCookie(recRes);

    // Reusing the same recovery code on a new challenge fails
    const login3 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    const login3Json = await login3.json();
    const recReuseRes = await app.request('/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        challengeToken: login3Json.challengeToken,
        code: recoveryCode,
        isRecoveryCode: true,
      }),
    });
    expect(recReuseRes.status).toBe(401);

    // Step 5: Disable 2FA with current password
    const disableRes = await app.request('/api/auth/2fa/disable', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: recCookie },
      body: JSON.stringify({ currentPassword: 'AdminPassword!123' }),
    });
    expect(disableRes.status).toBe(200);

    // Next login succeeds directly with password only
    const login4 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    expect((await login4.json()).status).toBe('authenticated');
  });

  it('supports admin member lifecycle management, immediate session revocation, and role guards', async () => {
    const adminLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'AdminPassword!123' }),
    });
    const adminCookie = extractSessionCookie(adminLogin);
    const adminId = (await adminLogin.json()).user.id;

    // Create normal user
    const createRes = await app.request('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({
        username: 'member.a@airnote.local',
        displayName: '成员甲',
        role: 'user',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.user.mustChangePassword).toBe(true);
    expect(created.temporaryPassword.length).toBeGreaterThanOrEqual(16);

    // Normal user logs in
    const userLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'member.a@airnote.local',
        password: created.temporaryPassword,
      }),
    });
    expect(userLogin.status).toBe(200);
    const userCookie = extractSessionCookie(userLogin);

    // Normal user is forbidden from admin routes
    const forbiddenRes = await app.request('/api/admin/users', {
      headers: { cookie: userCookie },
    });
    expect(forbiddenRes.status).toBe(403);

    // Admin cannot disable self
    const selfDisable = await app.request(`/api/admin/users/${adminId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(selfDisable.status).toBe(400);

    // Admin disables member A -> member A's active session is immediately revoked
    const disableRes = await app.request(`/api/admin/users/${created.user.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(disableRes.status).toBe(200);

    const memberMe = await app.request('/api/auth/me', { headers: { cookie: userCookie } });
    expect(memberMe.status).toBe(401);

    // Re-enable and reset password
    await app.request(`/api/admin/users/${created.user.id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ status: 'active' }),
    });

    const resetPassRes = await app.request(`/api/admin/users/${created.user.id}/reset-password`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    });
    expect(resetPassRes.status).toBe(200);
    const { temporaryPassword: newTempPass } = await resetPassRes.json();

    const relogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'member.a@airnote.local', password: newTempPass }),
    });
    expect(relogin.status).toBe(200);

    // Audit logs endpoint returns recorded security actions
    const auditRes = await app.request('/api/admin/audit-logs?page=1&pageSize=20', {
      headers: { cookie: adminCookie },
    });
    expect(auditRes.status).toBe(200);
    const auditJson = await auditRes.json();
    expect(auditJson.total).toBeGreaterThanOrEqual(4);
    expect(auditJson.items.some((i: { action: string }) => i.action === 'admin_create_user')).toBe(
      true,
    );
    expect(auditJson.items.some((i: { action: string }) => i.action === 'admin_disable_user')).toBe(
      true,
    );
  });

  it('enforces strict user_id isolation in ScopedDatabase', async () => {
    const userA = await seedUser({
      username: 'user.a@airnote.local',
      displayName: 'User A',
      password: 'PasswordA!123',
      role: 'user',
    });
    const userB = await seedUser({
      username: 'user.b@airnote.local',
      displayName: 'User B',
      password: 'PasswordB!123',
      role: 'user',
    });

    const nbId = generateId();
    const now = Date.now();
    db.prepare(
      'INSERT INTO notebooks (id, user_id, name, icon, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    ).run(nbId, userA, 'A Secret Notebook', '💎', '#6366F1', now, now);

    const scopedA = createScopedDb(db, userA);
    const scopedB = createScopedDb(db, userB);

    expect(scopedA.getNotebook(nbId)).toBeTruthy();
    expect(scopedB.getNotebook(nbId)).toBeUndefined();
    expect(scopedB.listNotebooks()).toHaveLength(0);
  });
});
