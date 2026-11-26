import { type MouseEvent, useEffect, useRef, useState } from 'react';
import {
  GEM_COLORS,
  type AuthUser,
  type NotebookItem,
  type PageSummary,
  type SectionItem,
} from '@shared/types';
import { BrandLogo } from '@client/components/BrandLogo';
import { NoteEditor } from '@client/components/editor/NoteEditor';
import {
  MovePageModal,
  NotebookDialog,
  SectionDialog,
} from '@client/components/modals/NoteModals';
import { type WorkspaceController, formatRelativeTime } from '@client/stores/useWorkspace';
import { burstSparkles } from '@client/utils/effects';

type ListViewMode = 'section' | 'pinned' | 'trash';

interface DesktopWorkspaceProps {
  user: AuthUser;
  workspace: WorkspaceController;
  theme: 'light' | 'dark';
  softGlow: boolean;
  onToggleTheme: (e?: MouseEvent) => void;
  onToggleGlow: (e?: MouseEvent) => void;
  onOpenSearch: () => void;
  onOpenSecurity: () => void;
  onOpenAdmin: () => void;
  onLogout: () => void;
  onToast: (message: string) => void;
}

export function DesktopWorkspace({
  user,
  workspace,
  theme,
  softGlow,
  onToggleTheme,
  onToggleGlow,
  onOpenSearch,
  onOpenSecurity,
  onOpenAdmin,
  onLogout,
  onToast,
}: DesktopWorkspaceProps) {
  const [focusMode, setFocusMode] = useState(false);
  const [listMode, setListMode] = useState<ListViewMode>('section');
  const [pageFilter, setPageFilter] = useState('');
  const [nbPopoverOpen, setNbPopoverOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [openPageMenuId, setOpenPageMenuId] = useState<string | null>(null);

  // Dialogs
  const [nbDialog, setNbDialog] = useState<{ mode: 'create' | 'edit'; item?: NotebookItem } | null>(
    null,
  );
  const [secDialog, setSecDialog] = useState<{
    mode: 'create' | 'edit';
    item?: SectionItem;
  } | null>(null);
  const [moveTargetPage, setMoveTargetPage] = useState<PageSummary | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  // Close popovers on outside click
  useEffect(() => {
    const closeAll = () => {
      setNbPopoverOpen(false);
      setUserMenuOpen(false);
      setOpenPageMenuId(null);
    };
    window.addEventListener('click', closeAll);
    return () => window.removeEventListener('click', closeAll);
  }, []);

  const {
    notebooks,
    allSections,
    sections,
    pages,
    pinnedPages,
    trashPages,
    activeNotebook,
    activeSection,
    activePage,
    syncStatus,
  } = workspace;

  const filteredPages = pageFilter.trim()
    ? pages.filter(
        (p) =>
          p.title.toLowerCase().includes(pageFilter.trim().toLowerCase()) ||
          p.preview.toLowerCase().includes(pageFilter.trim().toLowerCase()),
      )
    : pages;

  const handleAddPage = async (e: MouseEvent) => {
    if (!activeSection) return;
    setListMode('section');
    burstSparkles(e, softGlow);
    const created = await workspace.createPage(activeSection.id, null);
    if (created) {
      window.setTimeout(() => titleInputRef.current?.focus(), 60);
    }
  };

  const handleAddSubpage = async (e: MouseEvent, parentId?: string) => {
    const targetParentId = parentId ?? activePage?.id;
    if (!activeSection || !targetParentId) return;
    setListMode('section');
    burstSparkles(e, softGlow);
    const created = await workspace.createPage(activeSection.id, targetParentId);
    if (created) {
      window.setTimeout(() => titleInputRef.current?.focus(), 60);
    }
  };

  const moveSectionOrder = async (index: number, delta: -1 | 1) => {
    if (!activeNotebook) return;
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= sections.length) return;
    const ids = sections.map((s) => s.id);
    [ids[index], ids[targetIdx]] = [ids[targetIdx], ids[index]];
    await workspace.reorderSections(activeNotebook.id, ids);
  };

  const movePageOrder = async (index: number, delta: -1 | 1) => {
    if (!activeSection) return;
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= pages.length) return;
    const ids = pages.map((p) => p.id);
    [ids[index], ids[targetIdx]] = [ids[targetIdx], ids[index]];
    await workspace.reorderPages(activeSection.id, ids);
  };

  const syncBadge =
    syncStatus === 'saving'
      ? { dot: 'text-indigo-400', label: '正在保存...' }
      : syncStatus === 'dirty'
        ? { dot: 'text-amber-400', label: '待同步' }
        : syncStatus === 'error'
          ? { dot: 'text-rose-500', label: '同步失败' }
          : { dot: 'text-emerald-400', label: '已同步' };

  return (
    <main className="hidden md:flex relative z-10 flex-1 h-[100dvh] overflow-hidden p-3 gap-3">
      {/* ==================== Left Column: Notebooks & Sections ==================== */}
      {!focusMode && (
        <aside className="crystal-panel specular-track w-[256px] shrink-0 rounded-3xl flex flex-col h-full">
          {/* Top Brand + ⌘K Search */}
          <div className="px-4 pt-4 pb-2 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <BrandLogo size="sm" />
              <span className="font-extrabold text-[15px] tracking-tight">AirNote</span>
            </div>
            <button
              type="button"
              onClick={onOpenSearch}
              className="px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer flex items-center gap-1"
              style={{
                background: 'var(--glass-subtle)',
                border: '1px solid var(--border-soft)',
                color: 'var(--text-secondary)',
              }}
              title="全局搜索 (⌘K)"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <span className="font-mono-num text-[10px]">⌘K</span>
            </button>
          </div>

          {/* Notebook Dropdown Switcher (floating popover, never expands sidebar!) */}
          <div className="px-3 py-2 relative z-30 shrink-0">
            {activeNotebook ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setUserMenuOpen(false);
                  setNbPopoverOpen((prev) => !prev);
                }}
                className="w-full flex items-center justify-between p-2.5 rounded-2xl cursor-pointer transition-all"
                style={{
                  background: 'var(--glass-active)',
                  border: '1px solid var(--rim-outer)',
                  boxShadow: '0 6px 18px -6px rgba(99, 102, 241, 0.16)',
                }}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0"
                    style={{ background: `${activeNotebook.color}20` }}
                  >
                    {activeNotebook.icon}
                  </span>
                  <div className="text-left min-w-0">
                    <div className="text-[13px] font-bold truncate">{activeNotebook.name}</div>
                    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {activeNotebook.sectionCount} 分区 · {activeNotebook.pageCount} 页
                    </div>
                  </div>
                </div>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <path d="m7 15 5 5 5-5" />
                  <path d="m7 9 5-5 5 5" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setNbDialog({
                    mode: 'create',
                  })
                }
                className="btn-crystal w-full py-2.5 rounded-2xl text-xs font-bold cursor-pointer"
              >
                + 添加笔记本
              </button>
            )}

            {nbPopoverOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute left-3 right-3 top-full mt-1.5 crystal-popover rounded-2xl p-2 z-50 animate-crystal"
              >
                <div
                  className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  切换笔记本
                </div>
                <div className="space-y-1 my-1 max-h-52 overflow-y-auto">
                  {notebooks.map((nb) => {
                    const isActive = nb.id === activeNotebook?.id;
                    return (
                      <div
                        key={nb.id}
                        className="group flex items-center justify-between gap-1 rounded-xl px-2 py-1.5 transition-colors"
                        style={{ background: isActive ? 'var(--brand-soft)' : 'transparent' }}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setNbPopoverOpen(false);
                            setListMode('section');
                            void workspace.selectNotebook(nb.id);
                          }}
                          className="flex-1 flex items-center gap-2 min-w-0 text-left cursor-pointer"
                        >
                          <span>{nb.icon}</span>
                          <span
                            className="text-xs font-semibold truncate"
                            style={{ color: isActive ? 'var(--brand)' : 'var(--text-primary)' }}
                          >
                            {nb.name}
                          </span>
                        </button>
                        <span className="text-[11px] font-mono-num" style={{ color: 'var(--text-muted)' }}>
                          {nb.sectionCount}
                        </span>
                        <button
                          type="button"
                          title="编辑笔记本"
                          onClick={() => {
                            setNbPopoverOpen(false);
                            setNbDialog({ mode: 'edit', item: nb });
                          }}
                          className="opacity-60 hover:opacity-100 px-1 text-[11px] cursor-pointer"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          ✎
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="pt-1.5 mt-1.5" style={{ borderTop: '1px solid var(--border-soft)' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setNbPopoverOpen(false);
                      setNbDialog({ mode: 'create' });
                    }}
                    className="w-full py-2 rounded-xl text-xs font-semibold cursor-pointer"
                    style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                  >
                    + 添加笔记本
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Quick Views: Pinned & Trash */}
          <div className="px-3 pb-1.5 grid grid-cols-2 gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setListMode((m) => (m === 'pinned' ? 'section' : 'pinned'))}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer transition-all"
              style={{
                background: listMode === 'pinned' ? 'var(--brand-soft)' : 'var(--glass-subtle)',
                color: listMode === 'pinned' ? 'var(--brand)' : 'var(--text-secondary)',
                border: '1px solid var(--border-soft)',
              }}
            >
              <span>★ 星标</span>
              <span className="font-mono-num">{pinnedPages.length}</span>
            </button>
            <button
              type="button"
              onClick={() => setListMode((m) => (m === 'trash' ? 'section' : 'trash'))}
              className="flex items-center justify-between px-2.5 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer transition-all"
              style={{
                background: listMode === 'trash' ? 'rgba(244, 63, 94, 0.12)' : 'var(--glass-subtle)',
                color: listMode === 'trash' ? '#f43f5e' : 'var(--text-secondary)',
                border: '1px solid var(--border-soft)',
              }}
            >
              <span>🗑 回收站</span>
              <span className="font-mono-num">{trashPages.length}</span>
            </button>
          </div>

          {/* Sections Header */}
          <div className="px-4 pt-2 pb-1.5 flex items-center justify-between shrink-0">
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)' }}
            >
              分区 ({sections.length})
            </span>
            <button
              type="button"
              disabled={!activeNotebook}
              onClick={() => setSecDialog({ mode: 'create' })}
              className="text-[11px] font-semibold px-2 py-0.5 rounded-lg cursor-pointer disabled:opacity-40"
              style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
            >
              + 添加分区
            </button>
          </div>

          {/* Sections List */}
          <div className="flex-1 overflow-y-auto px-2.5 space-y-1 pb-3">
            {sections.length === 0 ? (
              <div className="text-center py-8 text-xs" style={{ color: 'var(--text-muted)' }}>
                {activeNotebook ? '暂无分区，点击右上角添加' : '请先添加笔记本'}
              </div>
            ) : (
              sections.map((sec, idx) => {
                const isActive = listMode === 'section' && sec.id === activeSection?.id;
                return (
                  <div
                    key={sec.id}
                    className="group flex items-center justify-between px-2.5 py-2 rounded-2xl transition-all"
                    style={{
                      background: isActive ? 'var(--glass-active)' : 'transparent',
                      border: `1px solid ${isActive ? 'var(--rim-outer)' : 'transparent'}`,
                      boxShadow: isActive ? `0 8px 18px -8px ${sec.color}50` : 'none',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setListMode('section');
                        void workspace.loadSectionPages(sec.id);
                      }}
                      className="flex-1 flex items-center gap-2.5 min-w-0 text-left cursor-pointer"
                    >
                      <span
                        className="w-2.5 h-4 rounded-full shrink-0 gem-facet"
                        style={{ ['--gem-color' as string]: sec.color }}
                      />
                      <span
                        className={`text-[13px] truncate ${isActive ? 'font-bold' : 'font-medium'}`}
                        style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                      >
                        {sec.name}
                      </span>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        {idx > 0 && (
                          <button
                            type="button"
                            title="上移"
                            onClick={() => void moveSectionOrder(idx, -1)}
                            className="w-5 h-5 rounded text-[10px] cursor-pointer hover:bg-black/5"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            ↑
                          </button>
                        )}
                        {idx < sections.length - 1 && (
                          <button
                            type="button"
                            title="下移"
                            onClick={() => void moveSectionOrder(idx, 1)}
                            className="w-5 h-5 rounded text-[10px] cursor-pointer hover:bg-black/5"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            ↓
                          </button>
                        )}
                        <button
                          type="button"
                          title="编辑分区"
                          onClick={() => setSecDialog({ mode: 'edit', item: sec })}
                          className="w-5 h-5 rounded text-[10px] cursor-pointer hover:bg-black/5"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          ✎
                        </button>
                      </div>
                      <span
                        className="text-[11px] font-mono-num group-hover:hidden"
                        style={{ color: isActive ? sec.color : 'var(--text-muted)' }}
                      >
                        {sec.pageCount}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom User Profile Bar + Floating Menu */}
          <div
            className="p-3 mt-auto relative z-30 shrink-0"
            style={{ borderTop: '1px solid var(--border-soft)' }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setNbPopoverOpen(false);
                setUserMenuOpen((prev) => !prev);
              }}
              className="w-full flex items-center justify-between p-2 rounded-2xl cursor-pointer transition-all"
              style={{ background: 'var(--glass-subtle)', border: '1px solid var(--border-soft)' }}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-xl btn-crystal flex items-center justify-center text-xs font-bold shrink-0">
                  {user.displayName.slice(0, 1)}
                </div>
                <div className="text-left min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold truncate">{user.displayName}</span>
                    <span
                      className="px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0"
                      style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                    >
                      {user.role === 'admin' ? '管理员' : '成员'}
                    </span>
                  </div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                    点击打开账号与设置
                  </div>
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ color: 'var(--text-muted)' }}>
                <circle cx="12" cy="12" r="1" />
                <circle cx="12" cy="5" r="1" />
                <circle cx="12" cy="19" r="1" />
              </svg>
            </button>

            {userMenuOpen && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-full left-3 right-3 mb-1.5 crystal-popover rounded-2xl p-2 z-50 space-y-1 animate-crystal"
              >
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onOpenSecurity();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer text-left hover:bg-black/5"
                >
                  <span>🛡️</span> 安全与 2FA 设置
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    onToggleTheme(e);
                    setUserMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium cursor-pointer text-left hover:bg-black/5"
                >
                  <span className="flex items-center gap-2.5">
                    <span>{theme === 'light' ? '🌙' : '💎'}</span> 切换深浅外观
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {theme === 'light' ? '浅色' : '深色'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    onToggleGlow(e);
                    setUserMenuOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-medium cursor-pointer text-left hover:bg-black/5"
                >
                  <span className="flex items-center gap-2.5">
                    <span>✦</span> 光效强度
                  </span>
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {softGlow ? '柔和' : '璀璨'}
                  </span>
                </button>
                {user.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      onOpenAdmin();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer text-left"
                    style={{ color: 'var(--brand)' }}
                  >
                    <span>👥</span> 管理员控制台
                  </button>
                )}
                <div className="my-1" style={{ borderTop: '1px solid var(--border-soft)' }} />
                <button
                  type="button"
                  onClick={() => {
                    setUserMenuOpen(false);
                    onLogout();
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-medium cursor-pointer text-left text-rose-500"
                >
                  <span>↪</span> 退出登录
                </button>
              </div>
            )}
          </div>
        </aside>
      )}

      {/* ==================== Middle Column: Pages / Pinned / Trash ==================== */}
      {!focusMode && (
        <aside className="crystal-panel specular-track w-[272px] shrink-0 rounded-3xl flex flex-col h-full">
          {listMode === 'section' ? (
            <>
              <div className="p-3.5 pb-2.5 flex items-center justify-between gap-2 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  {activeSection && (
                    <span
                      className="w-3 h-3 rounded-full shrink-0 gem-facet"
                      style={{ ['--gem-color' as string]: activeSection.color }}
                    />
                  )}
                  <h2 className="text-sm font-bold truncate">
                    {activeSection?.name || '未选择分区'}
                  </h2>
                </div>
                <button
                  type="button"
                  disabled={!activeSection}
                  onClick={handleAddPage}
                  className="btn-crystal px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer shrink-0"
                >
                  + 添加页面
                </button>
              </div>

              <div className="px-3 pb-3 shrink-0">
                <input
                  type="text"
                  value={pageFilter}
                  onChange={(e) => setPageFilter(e.target.value)}
                  placeholder="筛选当前分区页面..."
                  className="w-full px-3 py-2 text-xs rounded-xl outline-none"
                  style={{
                    background: 'var(--glass-input)',
                    border: '1px solid var(--border-soft)',
                    color: 'var(--text-primary)',
                  }}
                />
              </div>

              <div className="flex-1 overflow-y-auto px-2.5 space-y-1.5 pb-6">
                {filteredPages.length === 0 ? (
                  <div className="text-center py-10 px-4 space-y-2">
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {pageFilter.trim() ? '没有匹配的页面' : '当前分区还没有页面'}
                    </div>
                    {activeSection && !pageFilter.trim() && (
                      <button
                        type="button"
                        onClick={handleAddPage}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                        style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                      >
                        + 添加页面
                      </button>
                    )}
                  </div>
                ) : (
                  filteredPages.map((p, idx) => {
                    const isActive = activePage?.id === p.id;
                    const menuOpen = openPageMenuId === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`relative group rounded-2xl transition-all ${p.parentPageId ? 'pl-3' : ''}`}
                        style={{
                          background: isActive ? 'var(--glass-active)' : 'transparent',
                          border: `1px solid ${isActive ? 'var(--rim-outer)' : 'transparent'}`,
                          boxShadow: isActive ? 'var(--shadow-pill)' : 'none',
                        }}
                      >
                        <div className="flex items-start justify-between gap-1 p-3">
                          <button
                            type="button"
                            onClick={() => void workspace.loadPageDetail(p.id)}
                            className="flex-1 text-left min-w-0 cursor-pointer"
                          >
                            <div className="flex items-start justify-between gap-1.5">
                              <div
                                className="text-[13px] font-bold truncate"
                                style={{ color: isActive ? 'var(--brand)' : 'var(--text-primary)' }}
                              >
                                {p.parentPageId && <span className="opacity-45 mr-1">└</span>}
                                {p.title || '无标题页面'}
                              </div>
                              {p.isPinned && (
                                <span className="text-amber-400 text-xs shrink-0">★</span>
                              )}
                            </div>
                            <div
                              className="text-[11px] mt-1 truncate"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              {p.preview || '空白页...'}
                            </div>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenPageMenuId(menuOpen ? null : p.id);
                            }}
                            aria-label="页面操作"
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 cursor-pointer hover:bg-black/5"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            ⋯
                          </button>
                        </div>

                        {menuOpen && (
                          <div
                            onClick={(e) => e.stopPropagation()}
                            className="absolute right-2 top-10 crystal-popover rounded-2xl p-1.5 z-50 w-40 space-y-0.5 animate-crystal"
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                setOpenPageMenuId(null);
                                void handleAddSubpage(e, p.id);
                              }}
                              className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer hover:bg-black/5"
                            >
                              ↳ 添加子页面
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                setOpenPageMenuId(null);
                                if (!p.isPinned) burstSparkles(e, softGlow);
                                void workspace.togglePinPage(p.id, !p.isPinned);
                              }}
                              className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer hover:bg-black/5"
                            >
                              {p.isPinned ? '☆ 取消星标置顶' : '★ 星标置顶'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setOpenPageMenuId(null);
                                setMoveTargetPage(p);
                              }}
                              className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer hover:bg-black/5"
                            >
                              ⇄ 移动到其他分区
                            </button>
                            {!pageFilter.trim() && idx > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenPageMenuId(null);
                                  void movePageOrder(idx, -1);
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer hover:bg-black/5"
                              >
                                ↑ 上移一位
                              </button>
                            )}
                            {!pageFilter.trim() && idx < pages.length - 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenPageMenuId(null);
                                  void movePageOrder(idx, 1);
                                }}
                                className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer hover:bg-black/5"
                              >
                                ↓ 下移一位
                              </button>
                            )}
                            <div className="my-0.5" style={{ borderTop: '1px solid var(--border-soft)' }} />
                            <button
                              type="button"
                              onClick={() => {
                                setOpenPageMenuId(null);
                                void workspace.softDeletePage(p.id);
                              }}
                              className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs font-medium text-rose-500 cursor-pointer hover:bg-rose-500/10"
                            >
                              🗑 移至回收站
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </>
          ) : listMode === 'pinned' ? (
            <>
              <div className="p-3.5 pb-2.5 flex items-center justify-between shrink-0">
                <h2 className="text-sm font-bold flex items-center gap-1.5">
                  <span className="text-amber-400">★</span> 星标置顶 ({pinnedPages.length})
                </h2>
                <button
                  type="button"
                  onClick={() => setListMode('section')}
                  className="text-xs font-semibold cursor-pointer"
                  style={{ color: 'var(--brand)' }}
                >
                  返回分区
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2.5 space-y-1.5 pb-6">
                {pinnedPages.length === 0 ? (
                  <div className="text-center py-10 text-xs" style={{ color: 'var(--text-muted)' }}>
                    暂无星标置顶页面
                  </div>
                ) : (
                  pinnedPages.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setListMode('section');
                        void workspace.jumpToPage(p.notebookId, p.sectionId, p.id);
                      }}
                      className="w-full text-left p-3 rounded-2xl cursor-pointer transition-all"
                      style={{
                        background:
                          activePage?.id === p.id ? 'var(--glass-active)' : 'var(--glass-subtle)',
                        border: '1px solid var(--border-soft)',
                      }}
                    >
                      <div className="text-[13px] font-bold truncate">{p.title || '无标题页面'}</div>
                      <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                        {p.notebookIcon} {p.notebookName} › {p.sectionName}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
              <div className="p-3.5 pb-2.5 flex items-center justify-between shrink-0">
                <h2 className="text-sm font-bold">🗑 回收站 ({trashPages.length})</h2>
                <div className="flex items-center gap-2">
                  {trashPages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void workspace.emptyTrash()}
                      className="text-[11px] font-semibold text-rose-500 cursor-pointer"
                    >
                      清空
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setListMode('section')}
                    className="text-xs font-semibold cursor-pointer"
                    style={{ color: 'var(--brand)' }}
                  >
                    返回
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto px-2.5 space-y-2 pb-6">
                {trashPages.length === 0 ? (
                  <div className="text-center py-10 text-xs" style={{ color: 'var(--text-muted)' }}>
                    回收站为空
                  </div>
                ) : (
                  trashPages.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-2xl space-y-2"
                      style={{
                        background: 'var(--glass-subtle)',
                        border: '1px solid var(--border-soft)',
                      }}
                    >
                      <div>
                        <div className="text-xs font-bold truncate">{p.title || '无标题页面'}</div>
                        <div className="text-[10px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {p.notebookIcon} {p.notebookName} › {p.sectionName}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void workspace.restorePage(p.id)}
                          className="flex-1 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer"
                          style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          onClick={() => void workspace.permanentDeletePage(p.id)}
                          className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-rose-500 cursor-pointer"
                          style={{ background: 'rgba(244, 63, 94, 0.10)' }}
                        >
                          彻底删除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </aside>
      )}

      {/* ==================== Right Column: Editor Canvas ==================== */}
      <div className="crystal-canvas flex-1 rounded-3xl flex flex-col h-full overflow-hidden">
        {/* Top Breadcrumb & Actions Bar */}
        <div
          className="h-12 px-5 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--border-soft)' }}
        >
          <div className="flex items-center gap-2 text-xs min-w-0" style={{ color: 'var(--text-muted)' }}>
            <button
              type="button"
              onClick={() => setFocusMode((prev) => !prev)}
              className="p-1.5 rounded-xl cursor-pointer"
              style={{
                background: focusMode ? 'var(--brand-soft)' : 'var(--glass-subtle)',
                border: '1px solid var(--border-soft)',
                color: focusMode ? 'var(--brand)' : 'var(--text-secondary)',
              }}
              title={focusMode ? '退出专注模式' : '沉浸专注模式'}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect width="18" height="18" x="3" y="3" rx="2" />
                <path d="M9 3v18" />
              </svg>
            </button>
            {activeNotebook && (
              <>
                <span className="truncate">{activeNotebook.name}</span>
                <span className="opacity-40">›</span>
              </>
            )}
            {activeSection && (
              <>
                <span className="truncate">{activeSection.name}</span>
                <span className="opacity-40">›</span>
              </>
            )}
            <span className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {activePage ? activePage.title || '无标题页面' : '未选择页面'}
            </span>
          </div>

          {activePage && (
            <div className="flex items-center gap-2 shrink-0">
              <span
                className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
              >
                <span className={syncBadge.dot}>✦</span> {syncBadge.label}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  if (!activePage.isPinned) burstSparkles(e, softGlow);
                  void workspace.togglePinPage(activePage.id, !activePage.isPinned);
                }}
                className="w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer"
                style={{
                  background: 'var(--glass-subtle)',
                  color: activePage.isPinned ? '#F59E0B' : 'var(--text-muted)',
                }}
                title="星标置顶"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill={activePage.isPinned ? '#F59E0B' : 'none'}
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => void handleAddSubpage(e)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer"
                style={{
                  background: 'var(--glass-subtle)',
                  border: '1px solid var(--border-soft)',
                  color: 'var(--text-secondary)',
                }}
              >
                + 添加子页面
              </button>
              <button
                type="button"
                onClick={() => setMoveTargetPage(activePage)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium cursor-pointer"
                style={{
                  background: 'var(--glass-subtle)',
                  border: '1px solid var(--border-soft)',
                  color: 'var(--text-secondary)',
                }}
                title="移动到其他分区"
              >
                ⇄
              </button>
              <button
                type="button"
                onClick={() => void workspace.softDeletePage(activePage.id)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-rose-500 cursor-pointer"
                style={{ background: 'rgba(244, 63, 94, 0.08)' }}
                title="移至回收站"
              >
                🗑
              </button>
            </div>
          )}
        </div>

        {/* Editor Area */}
        {activePage ? (
          <div className="flex-1 overflow-y-auto px-8 sm:px-14 py-6">
            <div className="max-w-[740px] mx-auto animate-crystal flex flex-col min-h-full">
              <input
                ref={titleInputRef}
                type="text"
                value={activePage.title}
                onChange={(e) => workspace.updateActivePageDraft({ title: e.target.value })}
                placeholder="无标题页面"
                className="w-full text-[28px] font-extrabold tracking-tight bg-transparent outline-none mb-3"
                style={{ color: 'var(--text-primary)' }}
              />

              <div
                className="flex flex-wrap items-center gap-2 pb-4 mb-4 text-xs"
                style={{ borderBottom: '1px solid var(--border-soft)', color: 'var(--text-muted)' }}
              >
                <span className="font-mono-num">
                  更新于 {formatRelativeTime(activePage.updatedAt)}
                </span>
                <span>·</span>
                {activeSection && (
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                    style={{
                      background: `${activeSection.color}1A`,
                      color: activeSection.color,
                    }}
                  >
                    <span
                      className="w-2 h-2 rounded-full gem-facet"
                      style={{ ['--gem-color' as string]: activeSection.color }}
                    />
                    {activeSection.name}
                  </span>
                )}
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px]"
                  style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
                >
                  🔒 仅本人可见
                </span>
              </div>

              <NoteEditor
                pageId={activePage.id}
                contentJson={activePage.contentJson}
                contentText={activePage.contentText}
                variant="desktop"
                softGlow={softGlow}
                onChange={(payload) => workspace.updateActivePageDraft(payload)}
                onBlurSave={() => void workspace.flushPendingSave()}
                onToast={onToast}
              />
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
            <BrandLogo size="lg" />
            <div className="space-y-1.5 max-w-sm">
              <h3 className="text-lg font-extrabold">
                {!activeNotebook
                  ? '欢迎使用 AirNote'
                  : !activeSection
                    ? `「${activeNotebook.name}」还没有分区`
                    : `「${activeSection.name}」还没有页面`}
              </h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {!activeNotebook
                  ? '创建您的第一本笔记本，开始有序记录私密灵感、工作文档与日常备忘。'
                  : !activeSection
                    ? '添加一个彩晶分区来分类管理您的笔记页面。'
                    : '点击下方按钮创建新页面，所有内容将自动实时保存。'}
              </p>
            </div>
            {!activeNotebook ? (
              <button
                type="button"
                onClick={() => setNbDialog({ mode: 'create' })}
                className="btn-crystal px-6 py-2.5 rounded-2xl text-sm font-bold cursor-pointer"
              >
                + 添加笔记本
              </button>
            ) : !activeSection ? (
              <button
                type="button"
                onClick={() => setSecDialog({ mode: 'create' })}
                className="btn-crystal px-6 py-2.5 rounded-2xl text-sm font-bold cursor-pointer"
              >
                + 添加分区
              </button>
            ) : (
              <button
                type="button"
                onClick={handleAddPage}
                className="btn-crystal px-6 py-2.5 rounded-2xl text-sm font-bold cursor-pointer"
              >
                + 添加页面
              </button>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {nbDialog && (
        <NotebookDialog
          mode={nbDialog.mode}
          initial={nbDialog.item}
          defaultColor={GEM_COLORS[notebooks.length % GEM_COLORS.length]}
          onClose={() => setNbDialog(null)}
          onSubmit={async (data) => {
            if (nbDialog.mode === 'create') {
              await workspace.createNotebook(data);
            } else if (nbDialog.item) {
              await workspace.updateNotebook(nbDialog.item.id, data);
            }
          }}
          onDelete={
            nbDialog.mode === 'edit' && nbDialog.item
              ? async () => {
                  await workspace.deleteNotebook(nbDialog.item!.id);
                }
              : undefined
          }
        />
      )}

      {secDialog && activeNotebook && (
        <SectionDialog
          mode={secDialog.mode}
          notebookName={activeNotebook.name}
          initial={secDialog.item}
          defaultColor={GEM_COLORS[sections.length % GEM_COLORS.length]}
          onClose={() => setSecDialog(null)}
          onSubmit={async (data) => {
            if (secDialog.mode === 'create') {
              await workspace.createSection(activeNotebook.id, data);
            } else if (secDialog.item) {
              await workspace.updateSection(secDialog.item.id, data);
            }
          }}
          onDelete={
            secDialog.mode === 'edit' && secDialog.item
              ? async () => {
                  await workspace.deleteSection(secDialog.item!.id);
                }
              : undefined
          }
        />
      )}

      {moveTargetPage && (
        <MovePageModal
          pageTitle={moveTargetPage.title}
          currentSectionId={moveTargetPage.sectionId}
          notebooks={notebooks}
          allSections={allSections}
          onClose={() => setMoveTargetPage(null)}
          onSelectSection={async (targetSecId) => {
            await workspace.movePageToSection(moveTargetPage.id, targetSecId);
          }}
        />
      )}
    </main>
  );
}
