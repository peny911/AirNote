import crypto from 'node:crypto';
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

describe('AirNote Phase 2 — Notebooks, Sections, Pages & Strict User Isolation', () => {
  let db: DatabaseSync;
  let app: ReturnType<typeof createApp>;
  let cookieA: string;
  let cookieB: string;
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
    return extractSessionCookie(res);
  }

  beforeEach(async () => {
    db = initDatabase(':memory:');
    const config = loadConfig({
      dbPath: ':memory:',
      nodeEnv: 'test',
      masterKey: crypto.randomBytes(32),
      cookieSecure: false,
    });
    app = createApp({ db, config, rateLimiter: new DualDimensionRateLimiter() });

    cookieAdmin = await seedAndLogin('admin@airnote.local', 'admin');
    cookieA = await seedAndLogin('alice@airnote.local', 'user');
    cookieB = await seedAndLogin('bob@airnote.local', 'user');
  });

  afterEach(() => {
    db.close();
  });

  it('supports full notebook -> section -> page/subpage lifecycle, pinning, cross-section move, trash & reorder', async () => {
    // 1. Create notebook (auto-creates default section)
    const nbRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ name: '个人私密备忘', icon: '💎', color: '#6366F1' }),
    });
    expect(nbRes.status).toBe(201);
    const { notebook, defaultSection } = await nbRes.json();
    expect(notebook.name).toBe('个人私密备忘');
    expect(defaultSection.name).toBe('默认分区');

    // 2. Create a second section
    const sec2Res = await app.request(`/api/notebooks/${notebook.id}/sections`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ name: '主机与密钥', color: '#06B6D4' }),
    });
    expect(sec2Res.status).toBe(201);
    const { section: sec2 } = await sec2Res.json();

    // Reorder sections
    const reorderSecRes = await app.request(`/api/notebooks/${notebook.id}/sections/reorder`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ orderedIds: [sec2.id, defaultSection.id] }),
    });
    expect(reorderSecRes.status).toBe(200);
    const reorderedSecs = (await reorderSecRes.json()).sections;
    expect(reorderedSecs[0].id).toBe(sec2.id);

    // 3. Create empty page (strictly empty title & empty content — no fake placeholder text!)
    const page1Res = await app.request(`/api/sections/${defaultSection.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({}),
    });
    expect(page1Res.status).toBe(201);
    const { page: page1 } = await page1Res.json();
    expect(page1.title).toBe('');
    expect(page1.contentText).toBe('');

    // Update page content & pin it
    const updateRes = await app.request(`/api/pages/${page1.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        title: 'AirNote 架构定稿',
        contentText: 'SQLite WAL + FTS5 极速单进程方案',
        isPinned: true,
      }),
    });
    expect(updateRes.status).toBe(200);
    const updatedPage1 = (await updateRes.json()).page;
    expect(updatedPage1.isPinned).toBe(true);

    // 4. Create subpage under page1
    const subRes = await app.request(`/api/sections/${defaultSection.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ title: '子页面：移动端四级导航', parentPageId: page1.id }),
    });
    expect(subRes.status).toBe(201);
    const { page: subpage } = await subRes.json();
    expect(subpage.parentPageId).toBe(page1.id);

    // 5. Pinned list contains page1
    const pinnedRes = await app.request('/api/pages/pinned', { headers: { cookie: cookieA } });
    const { pages: pinned } = await pinnedRes.json();
    expect(pinned).toHaveLength(1);
    expect(pinned[0].id).toBe(page1.id);

    // 6. Move page1 (and its subpage) to sec2
    const moveRes = await app.request(`/api/pages/${page1.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ sectionId: sec2.id }),
    });
    expect(moveRes.status).toBe(200);

    const sec2Pages = (
      await (await app.request(`/api/sections/${sec2.id}/pages`, { headers: { cookie: cookieA } })).json()
    ).pages;
    expect(sec2Pages.map((p: { id: string }) => p.id)).toContain(page1.id);
    expect(sec2Pages.map((p: { id: string }) => p.id)).toContain(subpage.id);

    // 7. Soft delete subpage -> appears in trash, removed from active list -> restore -> permanent delete
    const delRes = await app.request(`/api/pages/${subpage.id}`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    expect(delRes.status).toBe(200);

    const trashRes = await app.request('/api/pages/trash', { headers: { cookie: cookieA } });
    const { pages: trashList } = await trashRes.json();
    expect(trashList).toHaveLength(1);
    expect(trashList[0].id).toBe(subpage.id);

    const restoreRes = await app.request(`/api/pages/${subpage.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ isDeleted: false }),
    });
    expect(restoreRes.status).toBe(200);

    const hardDelRes = await app.request(`/api/pages/${subpage.id}?permanent=true`, {
      method: 'DELETE',
      headers: { cookie: cookieA },
    });
    expect(hardDelRes.status).toBe(200);

    const getDeletedRes = await app.request(`/api/pages/${subpage.id}`, {
      headers: { cookie: cookieA },
    });
    expect(getDeletedRes.status).toBe(404);
  });

  it('strictly isolates User A data from User B and Admin across every note endpoint (IDOR defense)', async () => {
    // Alice creates a private notebook, section, and secret page
    const nbRes = await app.request('/api/notebooks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({ name: 'Alice Private Vault' }),
    });
    const { notebook: aliceNb, defaultSection: aliceSec } = await nbRes.json();

    const pgRes = await app.request(`/api/sections/${aliceSec.id}/pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookieA },
      body: JSON.stringify({
        title: 'Top Secret Key',
        contentText: 'alice-super-secret-token-9999',
      }),
    });
    const { page: alicePage } = await pgRes.json();

    // Bob attempts every read, search, update, move, and delete against Alice's IDs
    const bobChecks = await Promise.all([
      app.request('/api/notebooks', { headers: { cookie: cookieB } }),
      app.request(`/api/notebooks/${aliceNb.id}/sections`, { headers: { cookie: cookieB } }),
      app.request(`/api/notebooks/${aliceNb.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieB },
        body: JSON.stringify({ name: 'Hacked' }),
      }),
      app.request(`/api/notebooks/${aliceNb.id}`, {
        method: 'DELETE',
        headers: { cookie: cookieB },
      }),
      app.request(`/api/sections/${aliceSec.id}/pages`, { headers: { cookie: cookieB } }),
      app.request(`/api/sections/${aliceSec.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieB },
        body: JSON.stringify({ name: 'Hacked' }),
      }),
      app.request(`/api/pages/${alicePage.id}`, { headers: { cookie: cookieB } }),
      app.request(`/api/pages/${alicePage.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: cookieB },
        body: JSON.stringify({ title: 'Hacked' }),
      }),
      app.request(`/api/pages/${alicePage.id}`, {
        method: 'DELETE',
        headers: { cookie: cookieB },
      }),
      app.request('/api/pages/quick-search?q=alice-super-secret', {
        headers: { cookie: cookieB },
      }),
    ]);

    expect((await bobChecks[0].json()).notebooks).toHaveLength(0);
    expect(bobChecks[1].status).toBe(404);
    expect(bobChecks[2].status).toBe(404);
    expect(bobChecks[3].status).toBe(404);
    expect(bobChecks[4].status).toBe(404);
    expect(bobChecks[5].status).toBe(404);
    expect(bobChecks[6].status).toBe(404);
    expect(bobChecks[7].status).toBe(404);
    expect(bobChecks[8].status).toBe(404);
    expect((await bobChecks[9].json()).pages).toHaveLength(0);

    // Even Admin cannot read Alice's page or find it in search!
    const adminGetPage = await app.request(`/api/pages/${alicePage.id}`, {
      headers: { cookie: cookieAdmin },
    });
    expect(adminGetPage.status).toBe(404);

    const adminSearch = await app.request('/api/pages/quick-search?q=alice-super-secret', {
      headers: { cookie: cookieAdmin },
    });
    expect((await adminSearch.json()).pages).toHaveLength(0);

    // Alice's page remains completely intact
    const aliceVerify = await app.request(`/api/pages/${alicePage.id}`, {
      headers: { cookie: cookieA },
    });
    expect(aliceVerify.status).toBe(200);
    expect((await aliceVerify.json()).page.title).toBe('Top Secret Key');
  });
});
