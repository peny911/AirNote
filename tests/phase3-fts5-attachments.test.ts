import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
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

describe('AirNote Phase 3 — SQLite FTS5 Search & Isolated Attachments', () => {
  let db: DatabaseSync;
  let uploadsDir: string;
  let app: ReturnType<typeof createApp>;
  let aliceId: string;
  let cookieAlice: string;
  let cookieBob: string;
  let cookieAdmin: string;

  async function seedAndLogin(username: string, role: 'admin' | 'user' = 'user') {
    const id = generateId();
    const password = 'StrongPassword!123';
    const hash = await hashPassword(password);
    db.prepare(
      `INSERT INTO users (
         id, username, display_name, password_hash, role, status,
         totp_enabled, must_change_password, created_at
       ) VALUES (?, ?, ?, ?, ?, 'active', 0, 0, ?)`,
    ).run(id, username, username, hash, role, Date.now());

    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    expect(res.status).toBe(200);
    return { id, cookie: extractSessionCookie(res) };
  }

  beforeEach(async () => {
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'airnote-p3-uploads-'));
    db = initDatabase(':memory:', uploadsDir);
    const config = loadConfig({
      dbPath: ':memory:',
      uploadsDir,
      nodeEnv: 'test',
      masterKey: crypto.randomBytes(32),
      cookieSecure: false,
    });
    app = createApp({ db, config, rateLimiter: new DualDimensionRateLimiter() });

    cookieAdmin = (await seedAndLogin('admin@airnote.local', 'admin')).cookie;
    const alice = await seedAndLogin('alice@airnote.local', 'user');
    aliceId = alice.id;
    cookieAlice = alice.cookie;
    cookieBob = (await seedAndLogin('bob@airnote.local', 'user')).cookie;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  it('performs user-isolated FTS5 search for English & CJK terms and syncs with trash/restore', async () => {
    const nbRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieAlice },
      body: JSON.stringify({ name: '研发知识库' }),
    });
    const { defaultSection } = await nbRes.json();

    const pRes = await app.request(`/api/sections/${defaultSection.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieAlice },
      body: JSON.stringify({
        title: 'TipTap 富文本与 SQLite FTS5 调优',
        contentJson: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '使用 ProseMirror 内核实现极速琉璃体验。' }],
            },
          ],
        }),
        contentText: '使用 ProseMirror 内核实现极速琉璃体验。',
      }),
    });
    const { page } = await pRes.json();

    // 1. English FTS5 search
    const enRes = await app.request('/api/search?q=ProseMirror', {
      headers: { cookie: cookieAlice },
    });
    expect(enRes.status).toBe(200);
    const enHits = (await enRes.json()).results;
    expect(enHits).toHaveLength(1);
    expect(enHits[0].id).toBe(page.id);

    // 2. CJK mid-word substring search
    const zhRes = await app.request('/api/search?q=' + encodeURIComponent('琉璃体验'), {
      headers: { cookie: cookieAlice },
    });
    expect(zhRes.status).toBe(200);
    expect((await zhRes.json()).results).toHaveLength(1);

    // 3. Strict isolation: Bob & Admin cannot find Alice's note
    const bobSearch = await app.request('/api/search?q=ProseMirror', {
      headers: { cookie: cookieBob },
    });
    expect((await bobSearch.json()).results).toHaveLength(0);

    const adminSearch = await app.request('/api/search?q=ProseMirror', {
      headers: { cookie: cookieAdmin },
    });
    expect((await adminSearch.json()).results).toHaveLength(0);

    // 4. Soft-deleted page is excluded from search, restored page comes back
    await app.request(`/api/pages/${page.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieAlice },
    });
    const afterDelete = await app.request('/api/search?q=ProseMirror', {
      headers: { cookie: cookieAlice },
    });
    expect((await afterDelete.json()).results).toHaveLength(0);

    await app.request(`/api/pages/${page.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieAlice },
      body: JSON.stringify({ isDeleted: false }),
    });
    const afterRestore = await app.request('/api/search?q=ProseMirror', {
      headers: { cookie: cookieAlice },
    });
    expect((await afterRestore.json()).results).toHaveLength(1);
  });

  it('stores isolated per-user attachments, prevents XSS & cross-user IDOR, and cleans up files on delete', async () => {
    const nbRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieAlice },
      body: JSON.stringify({ name: '附件库' }),
    });
    const { defaultSection } = await nbRes.json();

    const pRes = await app.request(`/api/sections/${defaultSection.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieAlice },
      body: JSON.stringify({ title: '带图页面' }),
    });
    const { page } = await pRes.json();

    // 1. Upload PNG image
    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const formImg = new FormData();
    formImg.append('file', new File([pngBytes], 'diagram.png', { type: 'image/png' }));

    const uploadImgRes = await app.request(`/api/pages/${page.id}/attachments`, {
      method: 'POST',
      headers: { cookie: cookieAlice },
      body: formImg,
    });
    expect(uploadImgRes.status).toBe(201);
    const { attachment: imgAtt } = await uploadImgRes.json();
    expect(imgAtt.filename).toBe('diagram.png');
    expect(imgAtt.url).toBe(`/api/attachments/${imgAtt.id}`);

    // Physical file exists strictly inside uploadsDir/<aliceId>/
    const userDir = path.join(uploadsDir, aliceId);
    expect(fs.existsSync(path.join(userDir, `${imgAtt.id}.png`))).toBe(true);

    // Alice can stream image inline
    const getImgRes = await app.request(imgAtt.url, { headers: { cookie: cookieAlice } });
    expect(getImgRes.status).toBe(200);
    expect(getImgRes.headers.get('content-type')).toBe('image/png');
    expect(getImgRes.headers.get('content-disposition')).toContain('inline');
    expect(new Uint8Array(await getImgRes.arrayBuffer())).toEqual(pngBytes);

    // 2. Upload SVG/HTML forces attachment download + octet-stream (anti-XSS)
    const formHtml = new FormData();
    formHtml.append('file', new File(['<script>alert(1)</script>'], 'evil.html', { type: 'text/html' }));
    const uploadHtmlRes = await app.request(`/api/pages/${page.id}/attachments`, {
      method: 'POST',
      headers: { cookie: cookieAlice },
      body: formHtml,
    });
    expect(uploadHtmlRes.status).toBe(201);
    const { attachment: htmlAtt } = await uploadHtmlRes.json();

    const getHtmlRes = await app.request(htmlAtt.url, { headers: { cookie: cookieAlice } });
    expect(getHtmlRes.status).toBe(200);
    expect(getHtmlRes.headers.get('content-type')).toBe('application/octet-stream');
    expect(getHtmlRes.headers.get('content-disposition')).toContain('attachment');

    // 3. Strict IDOR defense: Bob & Admin cannot list, upload to, download, or delete Alice's attachments
    expect(
      (await app.request(imgAtt.url, { headers: { cookie: cookieBob } })).status,
    ).toBe(404);
    expect(
      (await app.request(imgAtt.url, { headers: { cookie: cookieAdmin } })).status,
    ).toBe(404);
    expect(
      (await app.request(imgAtt.url, { method: 'DELETE', headers: { cookie: cookieBob } })).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/pages/${page.id}/attachments`, { headers: { cookie: cookieBob } })).status,
    ).toBe(404);

    // 4. Deleting attachment removes physical file
    const delAttRes = await app.request(imgAtt.url, {
      method: 'DELETE',
      headers: { cookie: cookieAlice },
    });
    expect(delAttRes.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, `${imgAtt.id}.png`))).toBe(false);

    // 5. Permanently deleting page removes remaining physical attachment files
    const permDelRes = await app.request(`/api/pages/${page.id}?permanent=true`, {
      method: 'DELETE',
      headers: { cookie: cookieAlice },
    });
    expect(permDelRes.status).toBe(200);
    expect(fs.existsSync(path.join(userDir, `${htmlAtt.id}.html`))).toBe(false);
  });
});
