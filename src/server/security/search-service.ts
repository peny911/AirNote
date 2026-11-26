import type { DatabaseSync } from 'node:sqlite';
import type { SearchResultItem } from '../../shared/types.js';

export interface SearchService {
  search(userId: string, rawQuery: string, limit?: number): SearchResultItem[];
}

interface SearchRow {
  id: string;
  notebook_id: string;
  notebook_name: string;
  notebook_icon: string;
  section_id: string;
  section_name: string;
  section_color: string;
  title: string;
  snippet: string | null;
  content_text: string;
  is_pinned: number;
  updated_at: number;
}

function buildFtsMatchQuery(raw: string): string | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/["'*^():-]/g, '').trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t}"*`).join(' AND ');
}

function buildFallbackSnippet(contentText: string, rawQuery: string): string {
  const clean = contentText.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const q = rawQuery.trim();
  if (!q) return clean.slice(0, 120);

  const idx = clean.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return clean.slice(0, 120);

  const start = Math.max(0, idx - 32);
  const end = Math.min(clean.length, idx + q.length + 64);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < clean.length ? '...' : '';
  return `${prefix}${clean.slice(start, end)}${suffix}`;
}

function mapSearchRow(row: SearchRow, fallbackQuery: string): SearchResultItem {
  const snippet =
    row.snippet && row.snippet.trim().length > 0
      ? row.snippet
      : buildFallbackSnippet(row.content_text, fallbackQuery);

  return {
    id: row.id,
    notebookId: row.notebook_id,
    notebookName: row.notebook_name,
    notebookIcon: row.notebook_icon,
    sectionId: row.section_id,
    sectionName: row.section_name,
    sectionColor: row.section_color,
    title: row.title,
    snippet,
    isPinned: row.is_pinned === 1,
    updatedAt: row.updated_at,
  };
}

/**
 * 基于 SQLite FTS5 的全文检索服务（ADR-01 SearchService 抽象实现）：
 * 1. 严格绑定 user_id 隔离，杜绝跨用户检索泄漏；
 * 2. 优先走 pages_fts + bm25 相关性排序；
 * 3. 对中文连续子串自动补充用户隔离内的精确子串召回，兼顾英文词元与中文子串检索体验。
 */
export class SqliteFts5SearchService implements SearchService {
  constructor(private readonly db: DatabaseSync) {}

  search(userId: string, rawQuery: string, limit = 30): SearchResultItem[] {
    const q = rawQuery.trim();
    const safeLimit = Math.min(Math.max(1, limit), 50);

    if (!q) {
      const recent = this.db
        .prepare(
          `SELECT p.id, s.notebook_id, n.name AS notebook_name, n.icon AS notebook_icon,
                  p.section_id, s.name AS section_name, s.color AS section_color,
                  p.title, NULL AS snippet, p.content_text, p.is_pinned, p.updated_at
           FROM pages p
           JOIN sections s ON s.id = p.section_id AND s.user_id = ?
           JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
           WHERE p.user_id = ? AND p.is_deleted = 0
           ORDER BY p.updated_at DESC
           LIMIT ?`,
        )
        .all(userId, userId, userId, safeLimit) as unknown as SearchRow[];
      return recent.map((r) => mapSearchRow(r, ''));
    }

    const seen = new Set<string>();
    const results: SearchResultItem[] = [];

    // 1. Native FTS5 bm25 ranked search
    const matchExpr = buildFtsMatchQuery(q);
    if (matchExpr) {
      try {
        const ftsRows = this.db
          .prepare(
            `SELECT p.id, s.notebook_id, n.name AS notebook_name, n.icon AS notebook_icon,
                    p.section_id, s.name AS section_name, s.color AS section_color,
                    p.title,
                    snippet(pages_fts, 3, '', '', '...', 24) AS snippet,
                    p.content_text, p.is_pinned, p.updated_at
             FROM pages_fts
             JOIN pages p ON p.id = pages_fts.page_id AND p.user_id = ?
             JOIN sections s ON s.id = p.section_id AND s.user_id = ?
             JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
             WHERE pages_fts.user_id = ? AND p.is_deleted = 0 AND pages_fts MATCH ?
             ORDER BY bm25(pages_fts)
             LIMIT ?`,
          )
          .all(userId, userId, userId, userId, matchExpr, safeLimit) as unknown as SearchRow[];

        for (const row of ftsRows) {
          seen.add(row.id);
          results.push(mapSearchRow(row, q));
        }
      } catch {
        // Malformed FTS syntax falls through cleanly to scoped substring query
      }
    }

    // 2. Supplement for CJK mid-word substrings & section name matches
    if (results.length < safeLimit) {
      const remaining = safeLimit - results.length;
      const likePattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      const likeRows = this.db
        .prepare(
          `SELECT p.id, s.notebook_id, n.name AS notebook_name, n.icon AS notebook_icon,
                  p.section_id, s.name AS section_name, s.color AS section_color,
                  p.title, NULL AS snippet, p.content_text, p.is_pinned, p.updated_at
           FROM pages p
           JOIN sections s ON s.id = p.section_id AND s.user_id = ?
           JOIN notebooks n ON n.id = s.notebook_id AND n.user_id = ?
           WHERE p.user_id = ? AND p.is_deleted = 0
             AND (p.title LIKE ? ESCAPE '\\' OR p.content_text LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')
           ORDER BY p.updated_at DESC
           LIMIT ?`,
        )
        .all(
          userId,
          userId,
          userId,
          likePattern,
          likePattern,
          likePattern,
          remaining + seen.size,
        ) as unknown as SearchRow[];

      for (const row of likeRows) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        results.push(mapSearchRow(row, q));
        if (results.length >= safeLimit) break;
      }
    }

    return results;
  }
}
