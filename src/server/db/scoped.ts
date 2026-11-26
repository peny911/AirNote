import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  GEM_COLORS,
  type NotebookItem,
  type PageDetail,
  type PageSummary,
  type SectionItem,
} from '../../shared/types.js';
import { defaultContentCodec } from '../security/content-codec.js';
import { generateId } from '../security/crypto.js';

interface NotebookRow {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

interface SectionRow {
  id: string;
  user_id: string;
  notebook_id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: number;
  updated_at: number;
  page_count?: number;
}

interface PageRow {
  id: string;
  user_id: string;
  section_id: string;
  notebook_id: string;
  parent_page_id: string | null;
  title: string;
  content_json: string;
  content_text: string;
  encryption_ver: number;
  is_pinned: number;
  is_deleted: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
  section_name?: string;
  section_color?: string;
  notebook_name?: string;
  notebook_icon?: string;
}

const EMPTY_DOC_JSON = '{"type":"doc","content":[]}';

function makePreview(contentText: string): string {
  const cleaned = contentText.replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 120);
}

function mapPageSummary(row: PageRow): PageSummary {
  const decoded = defaultContentCodec.decode({
    contentJson: row.content_json,
    contentText: row.content_text,
    encryptionVer: row.encryption_ver,
  });

  return {
    id: row.id,
    sectionId: row.section_id,
    notebookId: row.notebook_id,
    parentPageId: row.parent_page_id,
    title: row.title,
    preview: makePreview(decoded.contentText),
    isPinned: row.is_pinned === 1,
    isDeleted: row.is_deleted === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.section_name !== undefined ? { sectionName: row.section_name } : {}),
    ...(row.section_color !== undefined ? { sectionColor: row.section_color } : {}),
    ...(row.notebook_name !== undefined ? { notebookName: row.notebook_name } : {}),
    ...(row.notebook_icon !== undefined ? { notebookIcon: row.notebook_icon } : {}),
  };
}

function mapPageDetail(row: PageRow): PageDetail {
  const decoded = defaultContentCodec.decode({
    contentJson: row.content_json,
    contentText: row.content_text,
    encryptionVer: row.encryption_ver,
  });

  return {
    ...mapPageSummary(row),
    contentJson: decoded.contentJson,
    contentText: decoded.contentText,
    encryptionVer: row.encryption_ver,
  };
}

/**
 * 强制 user_id 数据隔离层：
 * 所有业务资源（notebooks / sections / pages / attachments / pages_fts）的读写删查
 * 必须通过此隔离上下文绑定当前登录用户的 userId，杜绝跨用户 IDOR 越权。
 */
export class ScopedDatabase {
  constructor(
    private readonly db: DatabaseSync,
    public readonly userId: string,
  ) {}

  // ==================== FTS5 同步 ====================

  private upsertPageFts(pageId: string, title: string, contentText: string): void {
    this.db
      .prepare('DELETE FROM pages_fts WHERE page_id = ? AND user_id = ?')
      .run(pageId, this.userId);
    this.db
      .prepare('INSERT INTO pages_fts (page_id, user_id, title, content_text) VALUES (?, ?, ?, ?)')
      .run(pageId, this.userId, title, contentText);
  }

  private removePageFts(pageId: string): void {
    this.db
      .prepare('DELETE FROM pages_fts WHERE page_id = ? AND user_id = ?')
      .run(pageId, this.userId);
  }

  // ==================== 笔记本 ====================

  listNotebooks(): NotebookItem[] {
    const nbRows = this.db
      .prepare('SELECT * FROM notebooks WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(this.userId) as unknown as NotebookRow[];

    const secRows = this.db
      .prepare(
        `SELECT s.id, s.notebook_id, s.color,
                (SELECT COUNT(*) FROM pages p WHERE p.section_id = s.id AND p.user_id = ? AND p.is_deleted = 0) AS page_count
         FROM sections s
         WHERE s.user_id = ?
         ORDER BY s.sort_order ASC, s.created_at ASC`,
      )
      .all(this.userId, this.userId) as unknown as Array<{
      id: string;
      notebook_id: string;
      color: string;
      page_count: number;
    }>;

    const statsByNb = new Map<
      string,
      { sectionCount: number; pageCount: number; sectionColors: string[] }
    >();
    for (const s of secRows) {
      const entry = statsByNb.get(s.notebook_id) ?? {
        sectionCount: 0,
        pageCount: 0,
        sectionColors: [],
      };
      entry.sectionCount += 1;
      entry.pageCount += Number(s.page_count || 0);
      if (entry.sectionColors.length < 6) {
        entry.sectionColors.push(s.color);
      }
      statsByNb.set(s.notebook_id, entry);
    }

    return nbRows.map((row) => {
      const st = statsByNb.get(row.id) ?? { sectionCount: 0, pageCount: 0, sectionColors: [] };
      return {
        id: row.id,
        name: row.name,
        icon: row.icon,
        color: row.color,
        sortOrder: row.sort_order,
        sectionCount: st.sectionCount,
        pageCount: st.pageCount,
        sectionColors: st.sectionColors,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  getNotebook(notebookId: string): NotebookItem | undefined {
    const row = this.db
      .prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?')
      .get(notebookId, this.userId) as unknown as NotebookRow | undefined;
    if (!row) return undefined;

    const secRows = this.db
      .prepare(
        `SELECT s.color,
                (SELECT COUNT(*) FROM pages p WHERE p.section_id = s.id AND p.user_id = ? AND p.is_deleted = 0) AS page_count
         FROM sections s
         WHERE s.notebook_id = ? AND s.user_id = ?
         ORDER BY s.sort_order ASC, s.created_at ASC`,
      )
      .all(this.userId, notebookId, this.userId) as unknown as Array<{
      color: string;
      page_count: number;
    }>;

    return {
      id: row.id,
      name: row.name,
      icon: row.icon,
      color: row.color,
      sortOrder: row.sort_order,
      sectionCount: secRows.length,
      pageCount: secRows.reduce((acc, s) => acc + Number(s.page_count || 0), 0),
      sectionColors: secRows.slice(0, 6).map((s) => s.color),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createNotebook(input: {
    name: string;
    icon?: string;
    color?: string;
    createDefaultSection?: boolean;
  }): { notebook: NotebookItem; defaultSection?: SectionItem } {
    const countRow = this.db
      .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(sort_order), -1) AS max_order FROM notebooks WHERE user_id = ?')
      .get(this.userId) as unknown as { cnt: number; max_order: number };

    const id = generateId();
    const now = Date.now();
    const color = input.color ?? GEM_COLORS[countRow.cnt % GEM_COLORS.length];
    const icon = input.icon ?? '📓';
    const sortOrder = countRow.max_order + 1;

    let defaultSection: SectionItem | undefined;

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO notebooks (id, user_id, name, icon, color, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, this.userId, input.name, icon, color, sortOrder, now, now);

      if (input.createDefaultSection !== false) {
        const secId = generateId();
        this.db
          .prepare(
            `INSERT INTO sections (id, user_id, notebook_id, name, color, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          )
          .run(secId, this.userId, id, '默认分区', color, now, now);

        defaultSection = {
          id: secId,
          notebookId: id,
          name: '默认分区',
          color,
          sortOrder: 0,
          pageCount: 0,
          createdAt: now,
          updatedAt: now,
        };
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    const notebook = this.getNotebook(id)!;
    return { notebook, defaultSection };
  }

  updateNotebook(
    notebookId: string,
    patch: { name?: string; icon?: string; color?: string; sortOrder?: number },
  ): NotebookItem | undefined {
    const existing = this.db
      .prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?')
      .get(notebookId, this.userId) as unknown as NotebookRow | undefined;
    if (!existing) return undefined;

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE notebooks
         SET name = ?, icon = ?, color = ?, sort_order = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        patch.name ?? existing.name,
        patch.icon ?? existing.icon,
        patch.color ?? existing.color,
        patch.sortOrder ?? existing.sort_order,
        now,
        notebookId,
        this.userId,
      );

    return this.getNotebook(notebookId);
  }

  reorderNotebooks(orderedIds: string[]): void {
    const stmt = this.db.prepare(
      'UPDATE notebooks SET sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    );
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      orderedIds.forEach((id, idx) => {
        stmt.run(idx, now, id, this.userId);
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  deleteNotebook(notebookId: string): boolean {
    const existing = this.db
      .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
      .get(notebookId, this.userId);
    if (!existing) return false;

    const pageRows = this.db
      .prepare(
        `SELECT p.id FROM pages p
         JOIN sections s ON s.id = p.section_id
         WHERE s.notebook_id = ? AND p.user_id = ?`,
      )
      .all(notebookId, this.userId) as unknown as Array<{ id: string }>;

    this.db.exec('BEGIN');
    try {
      for (const p of pageRows) {
        this.removePageFts(p.id);
      }
      this.db
        .prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?')
        .run(notebookId, this.userId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return true;
  }

  // ==================== 分区 ====================

  listSections(notebookId: string): SectionItem[] | undefined {
    const nb = this.db
      .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
      .get(notebookId, this.userId);
    if (!nb) return undefined;

    const rows = this.db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM pages p WHERE p.section_id = s.id AND p.user_id = ? AND p.is_deleted = 0) AS page_count
         FROM sections s
         WHERE s.notebook_id = ? AND s.user_id = ?
         ORDER BY s.sort_order ASC, s.created_at ASC`,
      )
      .all(this.userId, notebookId, this.userId) as unknown as SectionRow[];

    return rows.map((row) => ({
      id: row.id,
      notebookId: row.notebook_id,
      name: row.name,
      color: row.color,
      sortOrder: row.sort_order,
      pageCount: Number(row.page_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  listAllSections(): SectionItem[] {
    const rows = this.db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM pages p WHERE p.section_id = s.id AND p.user_id = ? AND p.is_deleted = 0) AS page_count
         FROM sections s
         JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
         WHERE s.user_id = ?
         ORDER BY n.sort_order ASC, s.sort_order ASC, s.created_at ASC`,
      )
      .all(this.userId, this.userId, this.userId) as unknown as SectionRow[];

    return rows.map((row) => ({
      id: row.id,
      notebookId: row.notebook_id,
      name: row.name,
      color: row.color,
      sortOrder: row.sort_order,
      pageCount: Number(row.page_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  getSection(sectionId: string): SectionItem | undefined {
    const row = this.db
      .prepare(
        `SELECT s.*,
                (SELECT COUNT(*) FROM pages p WHERE p.section_id = s.id AND p.user_id = ? AND p.is_deleted = 0) AS page_count
         FROM sections s
         WHERE s.id = ? AND s.user_id = ?`,
      )
      .get(this.userId, sectionId, this.userId) as unknown as SectionRow | undefined;
    if (!row) return undefined;

    return {
      id: row.id,
      notebookId: row.notebook_id,
      name: row.name,
      color: row.color,
      sortOrder: row.sort_order,
      pageCount: Number(row.page_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createSection(
    notebookId: string,
    input: { name: string; color?: string },
  ): SectionItem | undefined {
    const nb = this.db
      .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
      .get(notebookId, this.userId);
    if (!nb) return undefined;

    const countRow = this.db
      .prepare(
        'SELECT COUNT(*) AS cnt, COALESCE(MAX(sort_order), -1) AS max_order FROM sections WHERE notebook_id = ? AND user_id = ?',
      )
      .get(notebookId, this.userId) as unknown as { cnt: number; max_order: number };

    const id = generateId();
    const now = Date.now();
    const color = input.color ?? GEM_COLORS[countRow.cnt % GEM_COLORS.length];
    const sortOrder = countRow.max_order + 1;

    this.db
      .prepare(
        `INSERT INTO sections (id, user_id, notebook_id, name, color, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, this.userId, notebookId, input.name, color, sortOrder, now, now);

    return this.getSection(id);
  }

  updateSection(
    sectionId: string,
    patch: { name?: string; color?: string; sortOrder?: number; notebookId?: string },
  ): SectionItem | undefined {
    const existing = this.db
      .prepare('SELECT * FROM sections WHERE id = ? AND user_id = ?')
      .get(sectionId, this.userId) as unknown as SectionRow | undefined;
    if (!existing) return undefined;

    let targetNotebookId = existing.notebook_id;
    if (patch.notebookId && patch.notebookId !== existing.notebook_id) {
      const targetNb = this.db
        .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
        .get(patch.notebookId, this.userId);
      if (!targetNb) return undefined;
      targetNotebookId = patch.notebookId;
    }

    const now = Date.now();
    this.db
      .prepare(
        `UPDATE sections
         SET name = ?, color = ?, sort_order = ?, notebook_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        patch.name ?? existing.name,
        patch.color ?? existing.color,
        patch.sortOrder ?? existing.sort_order,
        targetNotebookId,
        now,
        sectionId,
        this.userId,
      );

    return this.getSection(sectionId);
  }

  reorderSections(notebookId: string, orderedIds: string[]): boolean {
    const nb = this.db
      .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
      .get(notebookId, this.userId);
    if (!nb) return false;

    const stmt = this.db.prepare(
      'UPDATE sections SET sort_order = ?, updated_at = ? WHERE id = ? AND notebook_id = ? AND user_id = ?',
    );
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      orderedIds.forEach((id, idx) => {
        stmt.run(idx, now, id, notebookId, this.userId);
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return true;
  }

  deleteSection(sectionId: string): boolean {
    const existing = this.db
      .prepare('SELECT id FROM sections WHERE id = ? AND user_id = ?')
      .get(sectionId, this.userId);
    if (!existing) return false;

    const pageRows = this.db
      .prepare('SELECT id FROM pages WHERE section_id = ? AND user_id = ?')
      .all(sectionId, this.userId) as unknown as Array<{ id: string }>;

    this.db.exec('BEGIN');
    try {
      for (const p of pageRows) {
        this.removePageFts(p.id);
      }
      this.db
        .prepare('DELETE FROM sections WHERE id = ? AND user_id = ?')
        .run(sectionId, this.userId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return true;
  }

  // ==================== 页面与子页面 ====================

  listPages(sectionId: string): PageSummary[] | undefined {
    const sec = this.db
      .prepare('SELECT id FROM sections WHERE id = ? AND user_id = ?')
      .get(sectionId, this.userId);
    if (!sec) return undefined;

    const rows = this.db
      .prepare(
        `SELECT p.*, s.notebook_id, s.name AS section_name, s.color AS section_color,
                n.name AS notebook_name, n.icon AS notebook_icon
         FROM pages p
         JOIN sections s ON s.id = p.section_id AND s.user_id = ?
         JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
         WHERE p.section_id = ? AND p.user_id = ? AND p.is_deleted = 0
         ORDER BY p.sort_order ASC, p.created_at DESC`,
      )
      .all(this.userId, this.userId, sectionId, this.userId) as unknown as PageRow[];

    return rows.map(mapPageSummary);
  }

  listPinnedPages(): PageSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, s.notebook_id, s.name AS section_name, s.color AS section_color,
                n.name AS notebook_name, n.icon AS notebook_icon
         FROM pages p
         JOIN sections s ON s.id = p.section_id AND s.user_id = ?
         JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
         WHERE p.user_id = ? AND p.is_pinned = 1 AND p.is_deleted = 0
         ORDER BY p.updated_at DESC`,
      )
      .all(this.userId, this.userId, this.userId) as unknown as PageRow[];

    return rows.map(mapPageSummary);
  }

  listTrashPages(): PageSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.*, s.notebook_id, s.name AS section_name, s.color AS section_color,
                n.name AS notebook_name, n.icon AS notebook_icon
         FROM pages p
         JOIN sections s ON s.id = p.section_id AND s.user_id = ?
         JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
         WHERE p.user_id = ? AND p.is_deleted = 1
         ORDER BY p.updated_at DESC`,
      )
      .all(this.userId, this.userId, this.userId) as unknown as PageRow[];

    return rows.map(mapPageSummary);
  }

  getPage(pageId: string): PageDetail | undefined {
    const row = this.db
      .prepare(
        `SELECT p.*, s.notebook_id, s.name AS section_name, s.color AS section_color,
                n.name AS notebook_name, n.icon AS notebook_icon
         FROM pages p
         JOIN sections s ON s.id = p.section_id AND s.user_id = ?
         JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
         WHERE p.id = ? AND p.user_id = ?`,
      )
      .get(this.userId, this.userId, pageId, this.userId) as unknown as PageRow | undefined;
    if (!row) return undefined;
    return mapPageDetail(row);
  }

  createPage(
    sectionId: string,
    input: {
      title?: string;
      parentPageId?: string | null;
      contentJson?: string;
      contentText?: string;
    },
  ): PageDetail | undefined {
    const sec = this.db
      .prepare('SELECT id FROM sections WHERE id = ? AND user_id = ?')
      .get(sectionId, this.userId);
    if (!sec) return undefined;

    let resolvedParentId: string | null = null;
    if (input.parentPageId) {
      const parent = this.db
        .prepare(
          'SELECT id, parent_page_id FROM pages WHERE id = ? AND section_id = ? AND user_id = ? AND is_deleted = 0',
        )
        .get(input.parentPageId, sectionId, this.userId) as unknown as
        | { id: string; parent_page_id: string | null }
        | undefined;
      if (!parent) return undefined;
      // Keep clean sub-page nesting anchored to top-level parent if invoked from a child page
      resolvedParentId = parent.parent_page_id ?? parent.id;
    }

    const encoded = defaultContentCodec.encode(
      input.contentJson ?? EMPTY_DOC_JSON,
      input.contentText ?? '',
    );

    const id = generateId();
    const now = Date.now();
    const title = input.title ?? '';

    this.db.exec('BEGIN');
    try {
      let sortOrder = 0;
      if (resolvedParentId) {
        const parentRow = this.db
          .prepare('SELECT sort_order FROM pages WHERE id = ? AND user_id = ?')
          .get(resolvedParentId, this.userId) as unknown as { sort_order: number };
        const maxChildRow = this.db
          .prepare(
            'SELECT COALESCE(MAX(sort_order), ?) AS max_order FROM pages WHERE parent_page_id = ? AND section_id = ? AND user_id = ?',
          )
          .get(parentRow.sort_order, resolvedParentId, sectionId, this.userId) as unknown as {
          max_order: number;
        };
        sortOrder = maxChildRow.max_order + 1;
        this.db
          .prepare(
            'UPDATE pages SET sort_order = sort_order + 1 WHERE section_id = ? AND user_id = ? AND sort_order >= ?',
          )
          .run(sectionId, this.userId, sortOrder);
      } else {
        // Place newly created top-level page at the top of the section
        this.db
          .prepare(
            'UPDATE pages SET sort_order = sort_order + 1 WHERE section_id = ? AND user_id = ?',
          )
          .run(sectionId, this.userId);
        sortOrder = 0;
      }

      this.db
        .prepare(
          `INSERT INTO pages (
             id, user_id, section_id, parent_page_id, title,
             content_json, content_text, encryption_ver,
             is_pinned, is_deleted, sort_order, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
        )
        .run(
          id,
          this.userId,
          sectionId,
          resolvedParentId,
          title,
          encoded.contentJson,
          encoded.contentText,
          encoded.encryptionVer,
          sortOrder,
          now,
          now,
        );

      this.upsertPageFts(id, title, input.contentText ?? '');
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return this.getPage(id);
  }

  updatePage(
    pageId: string,
    patch: {
      title?: string;
      contentJson?: string;
      contentText?: string;
      isPinned?: boolean;
      isDeleted?: boolean;
      sectionId?: string;
      parentPageId?: string | null;
      sortOrder?: number;
    },
  ): PageDetail | undefined {
    const existing = this.db
      .prepare('SELECT * FROM pages WHERE id = ? AND user_id = ?')
      .get(pageId, this.userId) as unknown as PageRow | undefined;
    if (!existing) return undefined;

    let targetSectionId = existing.section_id;
    let targetParentId = existing.parent_page_id;

    if (patch.sectionId && patch.sectionId !== existing.section_id) {
      const targetSec = this.db
        .prepare('SELECT id FROM sections WHERE id = ? AND user_id = ?')
        .get(patch.sectionId, this.userId);
      if (!targetSec) return undefined;
      targetSectionId = patch.sectionId;
      // Detach parent when moving across sections so hierarchy stays consistent
      targetParentId = null;
    }

    if (patch.parentPageId !== undefined) {
      if (patch.parentPageId === null) {
        targetParentId = null;
      } else {
        if (patch.parentPageId === pageId) return undefined;
        const parent = this.db
          .prepare(
            'SELECT id, parent_page_id FROM pages WHERE id = ? AND section_id = ? AND user_id = ? AND is_deleted = 0',
          )
          .get(patch.parentPageId, targetSectionId, this.userId) as unknown as
          | { id: string; parent_page_id: string | null }
          | undefined;
        if (!parent) return undefined;
        targetParentId = parent.parent_page_id ?? parent.id;
      }
    }

    const decodedExisting = defaultContentCodec.decode({
      contentJson: existing.content_json,
      contentText: existing.content_text,
      encryptionVer: existing.encryption_ver,
    });

    const nextTitle = patch.title ?? existing.title;
    const nextContentJson = patch.contentJson ?? decodedExisting.contentJson;
    const nextContentText = patch.contentText ?? decodedExisting.contentText;
    const encoded = defaultContentCodec.encode(nextContentJson, nextContentText);

    const nextPinned =
      patch.isPinned !== undefined ? (patch.isPinned ? 1 : 0) : existing.is_pinned;
    const nextDeleted =
      patch.isDeleted !== undefined ? (patch.isDeleted ? 1 : 0) : existing.is_deleted;
    const nextSortOrder = patch.sortOrder ?? existing.sort_order;
    const now = Date.now();

    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `UPDATE pages
           SET section_id = ?, parent_page_id = ?, title = ?,
               content_json = ?, content_text = ?, encryption_ver = ?,
               is_pinned = ?, is_deleted = ?, sort_order = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .run(
          targetSectionId,
          targetParentId,
          nextTitle,
          encoded.contentJson,
          encoded.contentText,
          encoded.encryptionVer,
          nextPinned,
          nextDeleted,
          nextSortOrder,
          now,
          pageId,
          this.userId,
        );

      // If moving across sections, also move direct child sub-pages together
      if (targetSectionId !== existing.section_id) {
        this.db
          .prepare('UPDATE pages SET section_id = ?, updated_at = ? WHERE parent_page_id = ? AND user_id = ?')
          .run(targetSectionId, now, pageId, this.userId);
      }

      if (nextDeleted === 1) {
        this.removePageFts(pageId);
      } else {
        this.upsertPageFts(pageId, nextTitle, nextContentText);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return this.getPage(pageId);
  }

  reorderPages(sectionId: string, orderedIds: string[]): boolean {
    const sec = this.db
      .prepare('SELECT id FROM sections WHERE id = ? AND user_id = ?')
      .get(sectionId, this.userId);
    if (!sec) return false;

    const stmt = this.db.prepare(
      'UPDATE pages SET sort_order = ? WHERE id = ? AND section_id = ? AND user_id = ?',
    );
    this.db.exec('BEGIN');
    try {
      orderedIds.forEach((id, idx) => {
        stmt.run(idx, id, sectionId, this.userId);
      });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return true;
  }

  deletePage(pageId: string, permanent = false): boolean {
    const existing = this.db
      .prepare('SELECT id FROM pages WHERE id = ? AND user_id = ?')
      .get(pageId, this.userId);
    if (!existing) return false;

    this.db.exec('BEGIN');
    try {
      this.removePageFts(pageId);
      if (permanent) {
        this.db
          .prepare('DELETE FROM pages WHERE id = ? AND user_id = ?')
          .run(pageId, this.userId);
      } else {
        this.db
          .prepare(
            'UPDATE pages SET is_deleted = 1, is_pinned = 0, updated_at = ? WHERE id = ? AND user_id = ?',
          )
          .run(Date.now(), pageId, this.userId);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return true;
  }

  emptyTrash(): number {
    const trashRows = this.db
      .prepare('SELECT id FROM pages WHERE user_id = ? AND is_deleted = 1')
      .all(this.userId) as unknown as Array<{ id: string }>;

    this.db.exec('BEGIN');
    try {
      for (const row of trashRows) {
        this.removePageFts(row.id);
      }
      this.db
        .prepare('DELETE FROM pages WHERE user_id = ? AND is_deleted = 1')
        .run(this.userId);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return trashRows.length;
  }

  // ==================== 附件与检索（阶段三扩展） ====================

  getAttachment(attachmentId: string) {
    return this.db
      .prepare('SELECT * FROM attachments WHERE id = ? AND user_id = ?')
      .get(attachmentId, this.userId);
  }

  searchPagesQuick(rawQuery: string, limit = 30): PageSummary[] {
    const q = rawQuery.trim();
    if (!q) {
      const rows = this.db
        .prepare(
          `SELECT p.*, s.notebook_id, s.name AS section_name, s.color AS section_color,
                  n.name AS notebook_name, n.icon AS notebook_icon
           FROM pages p
           JOIN sections s ON s.id = p.section_id AND s.user_id = ?
           JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
           WHERE p.user_id = ? AND p.is_deleted = 0
           ORDER BY p.updated_at DESC
           LIMIT ?`,
        )
        .all(this.userId, this.userId, this.userId, limit) as unknown as PageRow[];
      return rows.map(mapPageSummary);
    }

    const likePattern = `%${q.replace(/[%_]/g, '\\$&')}%`;
    const rows = this.db
      .prepare(
        `SELECT p.*, s.notebook_id, s.name AS section_name, s.color AS section_color,
                n.name AS notebook_name, n.icon AS notebook_icon
         FROM pages p
         JOIN sections s ON s.id = p.section_id AND s.user_id = ?
         JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
         WHERE p.user_id = ? AND p.is_deleted = 0
           AND (p.title LIKE ? ESCAPE '\\' OR p.content_text LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')
         ORDER BY p.updated_at DESC
         LIMIT ?`,
      )
      .all(
        this.userId,
        this.userId,
        this.userId,
        likePattern,
        likePattern,
        likePattern,
        limit,
      ) as unknown as PageRow[];

    return rows.map(mapPageSummary);
  }
}

export function createScopedDb(db: DatabaseSync, userId: string): ScopedDatabase {
  return new ScopedDatabase(db, userId);
}

export function ensureUserUploadDir(uploadsDir: string, userId: string): string {
  const safeUserId = path.basename(userId);
  const dir = path.resolve(uploadsDir, safeUserId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
