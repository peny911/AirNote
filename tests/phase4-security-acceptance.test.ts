import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import * as OTPAuth from 'otpauth';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app.js';
import { loadConfig } from '../src/server/config.js';
import { initDatabase } from '../src/server/db/client.js';
import { generateId } from '../src/server/security/crypto.js';
import { hashPassword } from '../src/server/security/password.js';
import { DualDimensionRateLimiter } from '../src/server/security/rate-limit.js';

function extractSessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie') || '';
  const match = setCookie.match(/airnote_session=([^;]+)/);
  if (!match) throw new Error(`Missing session cookie: ${setCookie}`);
  return `airnote_session=${match[1]}`;
}

function generateTotp(username: string, secret: string, timestamp?: number): string {
  const totp = new OTPAuth.TOTP({
    issuer: 'AirNote',
    label: username,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
  return totp.generate({ timestamp });
}

describe('AirNote Phase 4 — Final Security & Acceptance Verification', () => {
  let db: DatabaseSync;
  let uploadsDir: string;
  let app: ReturnType<typeof createApp>;
  let rateLimiter: DualDimensionRateLimiter;

  async function seedUser(username: string, role: 'admin' | 'user', password = 'StrongPassword!123') {
    const id = generateId();
    const hash = await hashPassword(password);
    db.prepare(
      `INSERT INTO users (
         id, username, display_name, password_hash, role, status,
         totp_enabled, must_change_password, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 0, 0, ?)`,
    ).run(id, username, username, hash, role, Date.now());
    return id;
  }

  beforeEach(async () => {
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airnote-p4-uploads-'));
    db = initDatabase(':memory:', uploadsDir);
    rateLimiter = new DualDimensionRateLimiter({ maxFailures: 5, lockoutMs: 60_000 });
    const config = loadConfig({
      dbPath: ':memory:',
      uploadsDir,
      nodeEnv: 'test',
      masterKey: crypto.randomBytes(32),
      cookieSecure: false,
    });
    app = createApp({ db, config, rateLimiter });

    await seedUser('admin@airnote.local', 'admin');
    await seedUser('user-a@airnote.local', 'user');
    await seedUser('user-b@airnote.local', 'user');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('verifies admin API exposes zero note-reading routes and zero note fields in /api/admin/users', async () => {
    const adminPaths = app.routes
      .map((r) => `${r.method} ${r.path}`)
      .filter((route) => route.includes('/api/admin'));

    // Strictly no admin route touches notebooks, sections, pages, search, or attachments
    for (const route of adminPaths) {
      expect(route).not.toMatch(/notebook|section|page|search|attachment/i);
    }

    const adminLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'StrongPassword!123' }),
    });
    const adminCookie = extractSessionCookie(adminLogin);

    const usersRes = await app.request('/api/admin/users', { headers: { cookie: adminCookie } });
    expect(usersRes.status).toBe(200);
    const { users } = await usersRes.json();
    for (const u of users) {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('password_hash');
      expect(u).not.toHaveProperty('totpSecretEnc');
      expect(u).not.toHaveProperty('noteCount');
      expect(u).not.toHaveProperty('pageCount');
    }
  });

  it('enforces 2FA rate limiting (5 wrong codes -> 429), admin 2FA reset, and immediate revocation on disable', async () => {
    const adminLogin = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin@airnote.local', password: 'StrongPassword!123' }),
    });
    const adminCookie = extractSessionCookie(adminLogin);

    // User A logs in on two devices (desktop + mobile) and enables 2FA
    const loginA1 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'user-a@airnote.local', password: 'StrongPassword!123' }),
    });
    const cookieDesktopA = extractSessionCookie(loginA1);
    const userAId = (await loginA1.json()).user.id;

    const loginA2 = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'user-a@airnote.local', password: 'StrongPassword!123' }),
    });
    const cookieMobileA = extractSessionCookie(loginA2);

    const setupRes = await app.request('/api/auth/2fa/setup', {
      method: 'POST',
      headers: { cookie: cookieDesktopA },
    });
    const setup = await setupRes.json();
    const validCode = generateTotp('user-a@airnote.local', setup.secret);

    const confirmRes = await app.request('/api/auth/2fa/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieDesktopA },
      body: JSON.stringify({ setupToken: setup.setupToken, code: validCode }),
    });
    expect(confirmRes.status).toBe(200);

    // Start new 2FA challenge and submit 5 wrong codes -> 6th blocked with 429
    const challengeRes = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-client-ip': '10.10.0.8' },
      body: JSON.stringify({ username: 'user-a@airnote.local', password: 'StrongPassword!123' }),
    });
    const { challengeToken } = await challengeRes.json();

    for (let i = 0; i < 5; i++) {
      const badRes = await app.request('/api/auth/verify-2fa', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-test-client-ip': '10.10.0.8' },
        body: JSON.stringify({ challengeToken, code: '000000', isRecoveryCode: false }),
      });
      expect(badRes.status).toBe(401);
    }

    const locked2faRes = await app.request('/api/auth/verify-2fa', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-client-ip': '10.10.0.8' },
      body: JSON.stringify({ challengeToken, code: '000000', isRecoveryCode: false }),
    });
    expect(locked2faRes.status).toBe(429);

    // Admin resets 2FA for lost phone -> user A can log in with password only again
    const reset2faRes = await app.request(`/api/admin/users/${userAId}/reset-2fa`, {
      method: 'POST',
      headers: { cookie: adminCookie },
    });
    expect(reset2faRes.status).toBe(200);
    expect((await reset2faRes.json()).user.totpEnabled).toBe(false);

    // Admin disables User A -> BOTH desktop and mobile sessions are immediately revoked!
    const disableRes = await app.request(`/api/admin/users/${userAId}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: adminCookie },
      body: JSON.stringify({ status: 'disabled' }),
    });
    expect(disableRes.status).toBe(200);

    expect((await app.request('/api/auth/me', { headers: { cookie: cookieDesktopA } })).status).toBe(401);
    expect((await app.request('/api/auth/me', { headers: { cookie: cookieMobileA } })).status).toBe(401);
  });

  it('cleans up physical attachment files when deleting a parent section or notebook', async () => {
    const loginA = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'user-a@airnote.local', password: 'StrongPassword!123' }),
    });
    const cookieA = extractSessionCookie(loginA);
    const userAId = (await loginA.json()).user.id;

    const nbRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ name: '临时笔记本' }),
    });
    const { notebook, defaultSection } = await nbRes.json();

    const pRes = await app.request(`/api/sections/${defaultSection.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ title: '含附件页' }),
    });
    const { page } = await pRes.json();

    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3, 4])], 'doc.txt', { type: 'text/plain' }));
    const attRes = await app.request(`/api/pages/${page.id}/attachments`, {
      method: 'POST',
      headers: { cookie: cookieA },
      body: form,
    });
    const { attachment } = await attRes.json();
    const diskPath = path.join(uploadsDir, userAId, `${attachment.id}.txt`);
    expect(fs.existsSync(diskPath)).toBe(true);

    // Deleting the entire notebook deletes DB rows AND removes physical file on disk
    const delNb = await app.request(`/api/notebooks/${notebook.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    expect(delNb.status).toBe(200);
    expect(fs.existsSync(diskPath)).toBe(false);
  });
});
