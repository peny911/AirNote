import { type KeyboardEvent, useEffect, useState } from 'react';
import type { SearchResultItem } from '@shared/types';
import { searchApi } from '@client/api/client';
import { formatRelativeTime } from '@client/stores/useWorkspace';

interface QuickSearchModalProps {
  onClose: () => void;
  onSelectPage: (item: SearchResultItem) => void;
}

function renderHighlighted(text: string, query: string) {
  const q = query.trim();
  if (!q || !text) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, idx) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark
        key={idx}
        className="rounded px-0.5 font-semibold"
        style={{ background: 'rgba(250, 204, 21, 0.35)', color: 'inherit' }}
      >
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

export function QuickSearchModal({ onClose, onSelectPage }: QuickSearchModalProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchApi
        .search(query, 30)
        .then((res) => {
          if (active) {
            setResults(res.results);
            setSelectedIndex(0);
          }
        })
        .catch(() => {
          if (active) setResults([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 100);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && results.length > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp' && results.length > 0) {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      const target = results[selectedIndex] ?? results[0];
      if (target) {
        onSelectPage(target);
        onClose();
      }
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center pt-14 sm:pt-16 px-4"
      style={{ background: 'rgba(10, 15, 35, 0.42)', backdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="crystal-card w-full max-w-lg rounded-3xl overflow-hidden animate-crystal"
      >
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: '1px solid var(--border-soft)' }}
        >
          <span style={{ color: 'var(--brand)' }}>🔍</span>
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="全文检索 AirNote（FTS5 标题与正文）..."
            className="flex-1 bg-transparent text-[16px] sm:text-[15px] outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-semibold cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
          >
            取消
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2.5 space-y-1">
          {loading ? (
            <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              正在检索...
            </div>
          ) : results.length === 0 ? (
            <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              未找到匹配笔记
            </div>
          ) : (
            results.map((item, idx) => {
              const active = idx === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => {
                    onSelectPage(item);
                    onClose();
                  }}
                  className="w-full flex items-start justify-between gap-3 px-3.5 py-2.5 rounded-2xl text-left cursor-pointer transition-colors"
                  style={{
                    background: active ? 'var(--brand-soft)' : 'transparent',
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold truncate flex items-center gap-1.5">
                      <span>{renderHighlighted(item.title || '无标题页面', query)}</span>
                      {item.isPinned && <span className="text-amber-400">★</span>}
                    </div>
                    {item.snippet && (
                      <div
                        className="text-[11px] mt-0.5 line-clamp-1"
                        style={{ color: 'var(--text-secondary)' }}
                      >
                        {renderHighlighted(item.snippet, query)}
                      </div>
                    )}
                    <div
                      className="text-[10px] truncate mt-0.5 flex items-center gap-1"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <span>{item.notebookIcon || '📓'}</span>
                      <span>{item.notebookName}</span>
                      <span>›</span>
                      <span
                        className="w-1.5 h-1.5 rounded-full inline-block"
                        style={{ background: item.sectionColor }}
                      />
                      <span>{item.sectionName}</span>
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-mono-num shrink-0 pt-0.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {formatRelativeTime(item.updatedAt)}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <div
          className="px-4 py-2 flex items-center justify-between text-[10px]"
          style={{ borderTop: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
        >
          <span>FTS5 私有隔离全文检索</span>
          <span className="hidden sm:inline font-mono-num">↑↓ 选择 · Enter 打开 · Esc 关闭</span>
        </div>
      </div>
    </div>
  );
}
