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
import { burstSparkles, triggerEntranceSheen } from '@client/utils/effects';

export type MobileScreen = 'notebooks' | 'sections' | 'pages' | 'editor';

interface MobileWorkspaceProps {
  user: AuthUser;
  workspace: WorkspaceController;
  screen: MobileScreen;
  onScreenChange: (screen: MobileScreen) => void;
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

export function MobileWorkspace({
  user,
  workspace,
  screen,
  onScreenChange,
  theme,
  softGlow,
  onToggleTheme,
  onToggleGlow,
  onOpenSearch,
  onOpenSecurity,
  onOpenAdmin,
  onLogout,
  onToast,
}: MobileWorkspaceProps) {
  const [secFilter, setSecFilter] = useState('');
  const [userSheetOpen, setUserSheetOpen] = useState(false);
  const [pinnedSheetOpen, setPinnedSheetOpen] = useState(false);
  const [trashSheetOpen, setTrashSheetOpen] = useState(false);
  const [sectionGridOpen, setSectionGridOpen] = useState(false);
  const [actionPage, setActionPage] = useState<PageSummary | null>(null);
  const [moveTargetPage, setMoveTargetPage] = useState<PageSummary | null>(null);

  const [nbDialog, setNbDialog] = useState<{ mode: 'create' | 'edit'; item?: NotebookItem } | null>(
    null,
  );
  const [secDialog, setSecDialog] = useState<{
    mode: 'create' | 'edit';
    item?: SectionItem;
  } | null>(null);

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    triggerEntranceSheen(softGlow);
  }, [screen, softGlow]);

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

  const filteredSections = secFilter.trim()
    ? sections.filter((s) => s.name.toLowerCase().includes(secFilter.trim().toLowerCase()))
    : sections;

  const openNotebook = async (nbId: string) => {
    setSecFilter('');
    await workspace.selectNotebook(nbId);
    onScreenChange('sections');
  };

  const openSection = async (secId: string) => {
    await workspace.loadSectionPages(secId);
    onScreenChange('pages');
  };

  const openEditorForPage = async (pageId: string) => {
    await workspace.loadPageDetail(pageId);
    onScreenChange('editor');
  };

  const handleMobileCreatePage = async (e: MouseEvent) => {
    if (!activeSection) return;
    burstSparkles(e, softGlow);
    const created = await workspace.createPage(activeSection.id, null);
    if (created) {
      onScreenChange('editor');
      window.setTimeout(() => titleInputRef.current?.focus(), 80);
    }
  };

  const handleMobileAddSubpage = async (e: MouseEvent, target: PageSummary) => {
    burstSparkles(e, softGlow);
    const created = await workspace.createPage(target.sectionId, target.id);
    if (created) {
      onScreenChange('editor');
      window.setTimeout(() => titleInputRef.current?.focus(), 80);
    }
  };

  const renderTopRightActions = () => (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={onOpenSearch}
        aria-label="全局搜索"
        className="w-10 h-10 rounded-2xl flex items-center justify-center cursor-pointer"
        style={{
          background: 'var(--glass-elevated)',
          border: '1px solid var(--rim-outer)',
          color: 'var(--text-secondary)',
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => setUserSheetOpen(true)}
        aria-label="个人账号与设置"
        className="w-10 h-10 rounded-2xl btn-crystal flex items-center justify-center text-xs font-bold cursor-pointer"
      >
        {user.displayName.slice(0, 1)}
      </button>
    </div>
  );

  return (
    <div className="md:hidden relative z-10 flex-1 flex flex-col h-[100dvh] overflow-hidden">
      {/* ==================== L1: 笔记本（纯净书架，不混排分区） ==================== */}
      {screen === 'notebooks' && (
        <div className="relative flex-1 flex flex-col overflow-hidden animate-crystal">
          <header className="px-4 pt-3 pb-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <BrandLogo size="sm" />
              <span className="text-lg font-extrabold tracking-tight">AirNote</span>
            </div>
            {renderTopRightActions()}
          </header>

          <div className="flex-1 overflow-y-auto px-4 pb-28 space-y-4">
            {/* ★ 星标置顶直达卡 */}
            <button
              type="button"
              onClick={() => setPinnedSheetOpen(true)}
              className="crystal-card w-full p-3.5 rounded-3xl flex items-center justify-between cursor-pointer active:scale-[0.98] transition-transform"
            >
              <span className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-2xl flex items-center justify-center text-amber-400 text-base shrink-0"
                  style={{ background: 'rgba(245, 158, 11, 0.14)' }}
                >
                  ★
                </span>
                <span className="text-left">
                  <span className="block text-sm font-bold">星标置顶</span>
                  <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    已置顶 {pinnedPages.length} 个常用页面
                  </span>
                </span>
              </span>
              <span className="text-base font-bold pr-1" style={{ color: 'var(--text-muted)' }}>
                ›
              </span>
            </button>

            {/* 我的笔记本 */}
            <div>
              <div className="px-1 pb-2 flex items-center justify-between">
                <span
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'var(--text-muted)' }}
                >
                  我的笔记本 ({notebooks.length})
                </span>
              </div>

              {notebooks.length === 0 ? (
                <div
                  className="crystal-card rounded-3xl p-8 text-center space-y-2"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                    还没有笔记本
                  </div>
                  <div className="text-xs">点击底部「+ 添加笔记本」开启私密记录</div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {notebooks.map((nb) => (
                    <div
                      key={nb.id}
                      className="crystal-card rounded-3xl p-4 flex items-center justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => void openNotebook(nb.id)}
                        className="flex-1 flex items-center gap-3.5 min-w-0 text-left cursor-pointer active:scale-[0.99] transition-transform"
                      >
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl shrink-0 shadow-sm"
                          style={{
                            background: `linear-gradient(135deg, ${nb.color}2A, ${nb.color}10)`,
                            border: `1px solid ${nb.color}30`,
                          }}
                        >
                          {nb.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="text-[15px] font-extrabold truncate">{nb.name}</div>
                          <div
                            className="text-xs mt-0.5 font-mono-num"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {nb.sectionCount} 个分区 · {nb.pageCount} 页
                          </div>
                          {nb.sectionColors.length > 0 && (
                            <div className="flex items-center gap-1 mt-2">
                              {nb.sectionColors.map((c, i) => (
                                <span
                                  key={`${nb.id}-c-${i}`}
                                  className="w-2 h-2 rounded-full"
                                  style={{ background: c }}
                                />
                              ))}
                              {nb.sectionCount > nb.sectionColors.length && (
                                <span
                                  className="text-[10px] ml-0.5"
                                  style={{ color: 'var(--text-muted)' }}
                                >
                                  +{nb.sectionCount - nb.sectionColors.length}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </button>

                      <button
                        type="button"
                        aria-label="编辑笔记本"
                        onClick={() => setNbDialog({ mode: 'edit', item: nb })}
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 cursor-pointer"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        ⋯
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {trashPages.length > 0 && (
              <button
                type="button"
                onClick={() => setTrashSheetOpen(true)}
                className="w-full px-4 py-3 rounded-2xl flex items-center justify-between text-xs font-semibold cursor-pointer"
                style={{
                  background: 'var(--glass-subtle)',
                  border: '1px solid var(--border-soft)',
                  color: 'var(--text-secondary)',
                }}
              >
                <span>🗑 回收站（{trashPages.length} 个已删除页面）</span>
                <span>›</span>
              </button>
            )}
          </div>

          {/* Centered Floating Bottom Pill CTA: + 添加笔记本 */}
          <div
            className="absolute bottom-5 inset-x-4 z-20 flex justify-center pointer-events-none"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <button
              type="button"
              onClick={() => setNbDialog({ mode: 'create' })}
              className="pointer-events-auto btn-crystal h-12 px-7 rounded-full flex items-center justify-center gap-1.5 text-sm font-bold cursor-pointer"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              添加笔记本
            </button>
          </div>
        </div>
      )}

      {/* ==================== L2: 分区（当前笔记本专属分区纵向列表 + 筛选） ==================== */}
      {screen === 'sections' && activeNotebook && (
        <div className="relative flex-1 flex flex-col overflow-hidden animate-crystal">
          <header className="px-3.5 pt-3 pb-2 flex items-center justify-between shrink-0">
            <button
              type="button"
              onClick={() => onScreenChange('notebooks')}
              className="flex items-center gap-1 px-3 py-2 rounded-2xl text-xs font-bold cursor-pointer active:scale-95 transition-transform"
              style={{
                background: 'var(--glass-elevated)',
                border: '1px solid var(--rim-outer)',
                color: 'var(--brand)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m15 18-6-6 6-6" />
              </svg>
              笔记本
            </button>
            {renderTopRightActions()}
          </header>

          <div className="px-4 pt-1 pb-2.5 flex items-center gap-2.5 shrink-0">
            <span
              className="w-10 h-10 rounded-2xl flex items-center justify-center text-base shrink-0"
              style={{ background: `${activeNotebook.color}22` }}
            >
              {activeNotebook.icon}
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-extrabold truncate">{activeNotebook.name}</h2>
              <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                共 {sections.length} 个分区 · {activeNotebook.pageCount} 个页面
              </div>
            </div>
          </div>

          <div className="px-4 pb-2.5 shrink-0">
            <input
              type="text"
              value={secFilter}
              onChange={(e) => setSecFilter(e.target.value)}
              placeholder="筛选此笔记本内的分区..."
              className="w-full px-3.5 py-2.5 rounded-2xl text-[16px] outline-none"
              style={{
                background: 'var(--glass-input)',
                border: '1px solid var(--border-soft)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div className="flex-1 overflow-y-auto px-4 pt-0.5 pb-28 space-y-2">
            {filteredSections.length === 0 ? (
              <div className="text-center py-12 text-xs" style={{ color: 'var(--text-muted)' }}>
                {secFilter.trim() ? '没有匹配的分区' : '此笔记本暂无分区，点击底部按钮添加'}
              </div>
            ) : (
              filteredSections.map((sec) => (
                <div
                  key={sec.id}
                  className="crystal-card rounded-2xl px-4 py-3 flex items-center justify-between gap-2"
                >
                  <button
                    type="button"
                    onClick={() => void openSection(sec.id)}
                    className="flex-1 flex items-center justify-between gap-3 min-w-0 text-left cursor-pointer active:scale-[0.99] transition-transform"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-2.5 h-7 rounded-full gem-facet shrink-0"
                        style={{ ['--gem-color' as string]: sec.color }}
                      />
                      <span className="text-[15px] font-bold truncate">{sec.name}</span>
                    </div>
                    <span
                      className="text-xs font-mono-num shrink-0 flex items-center gap-1"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {sec.pageCount} 页 <span className="text-sm">›</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label="编辑分区"
                    onClick={() => setSecDialog({ mode: 'edit', item: sec })}
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ⋯
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Centered Floating Bottom Pill CTA: + 添加分区 (100% belongs to current notebook) */}
          <div
            className="absolute bottom-5 inset-x-4 z-20 flex justify-center pointer-events-none"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <button
              type="button"
              onClick={() => setSecDialog({ mode: 'create' })}
              className="pointer-events-auto btn-crystal h-12 px-7 rounded-full flex items-center justify-center gap-1.5 text-sm font-bold cursor-pointer"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              添加分区
            </button>
          </div>
        </div>
      )}

      {/* ==================== L3: 页面（点标题快切同本分区 + 显式 ⋯ 菜单） ==================== */}
      {screen === 'pages' && activeNotebook && activeSection && (
        <div className="relative flex-1 flex flex-col overflow-hidden animate-crystal">
          <header className="px-3.5 pt-3 pb-2 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onScreenChange('sections')}
              className="flex items-center gap-1 px-3 py-2 rounded-2xl text-xs font-bold cursor-pointer active:scale-95 transition-transform max-w-[160px]"
              style={{
                background: 'var(--glass-elevated)',
                border: '1px solid var(--rim-outer)',
                color: 'var(--brand)',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span className="truncate">{activeNotebook.name}</span>
            </button>
            {renderTopRightActions()}
          </header>

          {/* Clickable Section Title -> 2-column quick switch grid */}
          <div className="px-4 pt-1 pb-2.5 flex items-center justify-between gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSectionGridOpen(true)}
              className="flex items-center gap-2 min-w-0 px-3 py-1.5 -ml-1 rounded-2xl cursor-pointer"
              style={{ background: 'var(--glass-subtle)', border: '1px solid var(--border-soft)' }}
            >
              <span
                className="w-2.5 h-2.5 rounded-full gem-facet shrink-0"
                style={{ ['--gem-color' as string]: activeSection.color }}
              />
              <h2 className="text-base font-extrabold truncate">{activeSection.name}</h2>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" className="shrink-0" style={{ color: 'var(--text-muted)' }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <span className="text-[11px] font-mono-num shrink-0" style={{ color: 'var(--text-muted)' }}>
              {pages.length} 个页面
            </span>
          </div>

          <div className="flex-1 overflow-y-auto px-3.5 pt-0.5 pb-28 space-y-2.5">
            {pages.length === 0 ? (
              <div className="crystal-card rounded-3xl p-8 text-center space-y-1.5">
                <div className="text-sm font-bold">当前分区暂无页面</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  点击底部「+ 添加页面」开始记录
                </div>
              </div>
            ) : (
              pages.map((p) => (
                <div
                  key={p.id}
                  className={`crystal-card rounded-3xl p-4 flex items-start justify-between gap-2 ${
                    p.parentPageId ? 'ml-4' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void openEditorForPage(p.id)}
                    className="flex-1 text-left min-w-0 cursor-pointer"
                  >
                    <div
                      className="text-sm font-bold leading-snug flex items-center gap-1.5"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      <span className="truncate">
                        {p.parentPageId && <span className="opacity-45 mr-1">└</span>}
                        {p.title || '无标题页面'}
                      </span>
                      {p.isPinned && <span className="text-amber-400 text-xs shrink-0">★</span>}
                    </div>
                    <div
                      className="text-xs mt-1.5 line-clamp-2 leading-relaxed"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {p.preview || '点击开始书写...'}
                    </div>
                    <div
                      className="text-[11px] font-mono-num mt-2.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {formatRelativeTime(p.updatedAt)}
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label="页面更多操作"
                    onClick={() => setActionPage(p)}
                    className="w-10 h-10 -mr-1 -mt-1 rounded-xl flex items-center justify-center shrink-0 cursor-pointer"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <circle cx="12" cy="12" r="1" />
                      <circle cx="19" cy="12" r="1" />
                      <circle cx="5" cy="12" r="1" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Centered Floating Bottom Pill CTA: + 添加页面 */}
          <div
            className="absolute bottom-5 inset-x-4 z-20 flex justify-center pointer-events-none"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <button
              type="button"
              onClick={(e) => void handleMobileCreatePage(e)}
              className="pointer-events-auto btn-crystal h-12 px-7 rounded-full flex items-center justify-center gap-1.5 text-sm font-bold cursor-pointer"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6">
                <path d="M5 12h14" />
                <path d="M12 5v14" />
              </svg>
              添加页面
            </button>
          </div>
        </div>
      )}

      {/* ==================== L4: 全屏沉浸编辑页 + 贴底拇指格式化栏 ==================== */}
      {screen === 'editor' && activePage && (
        <div className="relative flex-1 flex flex-col overflow-hidden animate-crystal">
          <header
            className="px-3 py-2.5 flex items-center justify-between shrink-0"
            style={{
              borderBottom: '1px solid var(--border-soft)',
              background: 'var(--glass-panel)',
              backdropFilter: 'blur(20px)',
            }}
          >
            <button
              type="button"
              onClick={async () => {
                await workspace.flushPendingSave();
                onScreenChange('pages');
              }}
              className="flex items-center gap-1 px-2.5 py-2 rounded-xl text-xs font-bold cursor-pointer"
              style={{ color: 'var(--brand)', background: 'var(--brand-soft)' }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="m15 18-6-6 6-6" />
              </svg>
              <span className="max-w-[120px] truncate">{activeSection?.name || '返回'}</span>
            </button>

            <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
              <span
                className={
                  syncStatus === 'saving'
                    ? 'text-indigo-400'
                    : syncStatus === 'dirty'
                      ? 'text-amber-400'
                      : 'text-emerald-400'
                }
              >
                ✦
              </span>{' '}
              {syncStatus === 'saving' ? '保存中' : syncStatus === 'dirty' ? '待同步' : '已同步'}
            </span>

            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="星标置顶"
                onClick={(e) => {
                  if (!activePage.isPinned) burstSparkles(e, softGlow);
                  void workspace.togglePinPage(activePage.id, !activePage.isPinned);
                }}
                className="w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer"
                style={{
                  background: 'var(--glass-subtle)',
                  color: activePage.isPinned ? '#F59E0B' : 'var(--text-muted)',
                }}
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
                aria-label="更多页面操作"
                onClick={() => setActionPage(activePage)}
                className="w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer"
                style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="1" />
                  <circle cx="19" cy="12" r="1" />
                  <circle cx="5" cy="12" r="1" />
                </svg>
              </button>
            </div>
          </header>

          <div
            className="flex-1 overflow-y-auto px-5 py-5 pb-24"
            style={{ background: 'var(--glass-canvas)' }}
          >
            <input
              ref={titleInputRef}
              type="text"
              value={activePage.title}
              onChange={(e) => workspace.updateActivePageDraft({ title: e.target.value })}
              placeholder="页面标题"
              className="w-full text-[22px] font-extrabold bg-transparent outline-none mb-2"
              style={{ color: 'var(--text-primary)' }}
            />
            <div
              className="flex items-center gap-2 text-[11px] mb-4 pb-3"
              style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-soft)' }}
            >
              <span className="font-mono-num">{formatRelativeTime(activePage.updatedAt)}</span>
              <span>·</span>
              {activeSection && (
                <span
                  className="px-2 py-0.5 rounded-full font-semibold"
                  style={{
                    background: `${activeSection.color}1D`,
                    color: activeSection.color,
                  }}
                >
                  {activeSection.name}
                </span>
              )}
            </div>
            <NoteEditor
              pageId={activePage.id}
              contentJson={activePage.contentJson}
              contentText={activePage.contentText}
              variant="mobile"
              softGlow={softGlow}
              onChange={(payload) => workspace.updateActivePageDraft(payload)}
              onBlurSave={() => void workspace.flushPendingSave()}
              onToast={onToast}
            />
          </div>
        </div>
      )}

      {/* ==================== Bottom Sheet: 2-Column Section Quick Switch ==================== */}
      {sectionGridOpen && activeNotebook && (
        <div
          onClick={() => setSectionGridOpen(false)}
          className="fixed inset-0 z-40 flex items-end"
          style={{ background: 'rgba(10, 15, 35, 0.42)', backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="crystal-card w-full max-h-[78dvh] rounded-t-[30px] p-5 pb-8 flex flex-col animate-crystal"
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-3 opacity-30" style={{ background: 'var(--text-muted)' }} />
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-sm font-extrabold">快速切换分区</div>
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  {activeNotebook.icon} {activeNotebook.name} · 共 {sections.length} 个分区
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSectionGridOpen(false);
                  setSecDialog({ mode: 'create' });
                }}
                className="text-xs font-bold px-3 py-1.5 rounded-xl cursor-pointer"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
              >
                + 添加分区
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5 overflow-y-auto py-1">
              {sections.map((sec) => {
                const isActive = sec.id === activeSection?.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => {
                      setSectionGridOpen(false);
                      void workspace.loadSectionPages(sec.id);
                    }}
                    className="p-3.5 rounded-2xl text-left cursor-pointer active:scale-95 transition-transform"
                    style={{
                      background: isActive ? 'var(--brand-soft)' : 'var(--glass-subtle)',
                      border: `1px solid ${isActive ? 'var(--brand)' : 'var(--border-soft)'}`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className="w-3 h-3 rounded-full gem-facet"
                        style={{ ['--gem-color' as string]: sec.color }}
                      />
                      <span className="text-[11px] font-mono-num" style={{ color: 'var(--text-muted)' }}>
                        {sec.pageCount} 页
                      </span>
                    </div>
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text-primary)' }}>
                      {sec.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== Bottom Sheet: Pinned Pages ==================== */}
      {pinnedSheetOpen && (
        <div
          onClick={() => setPinnedSheetOpen(false)}
          className="fixed inset-0 z-40 flex items-end"
          style={{ background: 'rgba(10, 15, 35, 0.42)', backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="crystal-card w-full max-h-[75dvh] rounded-t-[30px] p-5 pb-8 flex flex-col animate-crystal"
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-3 opacity-30" style={{ background: 'var(--text-muted)' }} />
            <div className="text-sm font-extrabold mb-3">★ 星标置顶页面</div>
            <div className="space-y-2 overflow-y-auto">
              {pinnedPages.length === 0 ? (
                <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  暂无星标置顶页面
                </div>
              ) : (
                pinnedPages.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={async () => {
                      setPinnedSheetOpen(false);
                      await workspace.jumpToPage(p.notebookId, p.sectionId, p.id);
                      onScreenChange('editor');
                    }}
                    className="w-full p-3.5 rounded-2xl text-left cursor-pointer"
                    style={{ background: 'var(--glass-subtle)', border: '1px solid var(--border-soft)' }}
                  >
                    <div className="text-sm font-bold truncate">{p.title || '无标题页面'}</div>
                    <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                      {p.notebookIcon} {p.notebookName} › {p.sectionName}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== Bottom Sheet: Trash ==================== */}
      {trashSheetOpen && (
        <div
          onClick={() => setTrashSheetOpen(false)}
          className="fixed inset-0 z-40 flex items-end"
          style={{ background: 'rgba(10, 15, 35, 0.42)', backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="crystal-card w-full max-h-[75dvh] rounded-t-[30px] p-5 pb-8 flex flex-col animate-crystal"
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-3 opacity-30" style={{ background: 'var(--text-muted)' }} />
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-extrabold">🗑 回收站 ({trashPages.length})</span>
              {trashPages.length > 0 && (
                <button
                  type="button"
                  onClick={() => void workspace.emptyTrash()}
                  className="text-xs font-bold text-rose-500 cursor-pointer"
                >
                  清空回收站
                </button>
              )}
            </div>
            <div className="space-y-2 overflow-y-auto">
              {trashPages.length === 0 ? (
                <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  回收站为空
                </div>
              ) : (
                trashPages.map((p) => (
                  <div
                    key={p.id}
                    className="p-3.5 rounded-2xl space-y-2"
                    style={{ background: 'var(--glass-subtle)', border: '1px solid var(--border-soft)' }}
                  >
                    <div>
                      <div className="text-sm font-bold truncate">{p.title || '无标题页面'}</div>
                      <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                        {p.notebookIcon} {p.notebookName} › {p.sectionName}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void workspace.restorePage(p.id)}
                        className="flex-1 py-2 rounded-xl text-xs font-bold cursor-pointer"
                        style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                      >
                        恢复页面
                      </button>
                      <button
                        type="button"
                        onClick={() => void workspace.permanentDeletePage(p.id)}
                        className="px-3.5 py-2 rounded-xl text-xs font-bold text-rose-500 cursor-pointer"
                        style={{ background: 'rgba(244, 63, 94, 0.10)' }}
                      >
                        彻底删除
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================== Bottom Sheet: Page Actions (⋯) ==================== */}
      {actionPage && (
        <div
          onClick={() => setActionPage(null)}
          className="fixed inset-0 z-40 flex items-end"
          style={{ background: 'rgba(10, 15, 35, 0.42)', backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="crystal-card w-full rounded-t-[30px] p-5 pb-8 space-y-2 animate-crystal"
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-2 opacity-30" style={{ background: 'var(--text-muted)' }} />
            <div
              className="text-xs font-bold truncate pb-2"
              style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-soft)' }}
            >
              {actionPage.title || '无标题页面'}
            </div>
            <button
              type="button"
              onClick={(e) => {
                const target = actionPage;
                setActionPage(null);
                void handleMobileAddSubpage(e, target);
              }}
              className="w-full text-left p-3.5 rounded-2xl text-sm font-semibold cursor-pointer"
              style={{ background: 'var(--glass-subtle)' }}
            >
              ↳ 添加子页面
            </button>
            <button
              type="button"
              onClick={(e) => {
                const target = actionPage;
                setActionPage(null);
                if (!target.isPinned) burstSparkles(e, softGlow);
                void workspace.togglePinPage(target.id, !target.isPinned);
              }}
              className="w-full text-left p-3.5 rounded-2xl text-sm font-semibold cursor-pointer"
              style={{ background: 'var(--glass-subtle)' }}
            >
              {actionPage.isPinned ? '☆ 取消星标置顶' : '★ 切换星标置顶'}
            </button>
            <button
              type="button"
              onClick={() => {
                const target = actionPage;
                setActionPage(null);
                setMoveTargetPage(target);
              }}
              className="w-full text-left p-3.5 rounded-2xl text-sm font-semibold cursor-pointer"
              style={{ background: 'var(--glass-subtle)' }}
            >
              ⇄ 移动到其他分区
            </button>
            <button
              type="button"
              onClick={async () => {
                const target = actionPage;
                setActionPage(null);
                await workspace.softDeletePage(target.id);
                if (screen === 'editor') onScreenChange('pages');
              }}
              className="w-full text-left p-3.5 rounded-2xl text-sm font-semibold text-rose-500 cursor-pointer"
              style={{ background: 'rgba(244, 63, 94, 0.08)' }}
            >
              🗑 移至回收站
            </button>
          </div>
        </div>
      )}

      {/* ==================== Bottom Sheet: User Menu ==================== */}
      {userSheetOpen && (
        <div
          onClick={() => setUserSheetOpen(false)}
          className="fixed inset-0 z-40 flex items-end"
          style={{ background: 'rgba(10, 15, 35, 0.42)', backdropFilter: 'blur(4px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="crystal-card w-full rounded-t-[30px] p-5 pb-8 space-y-2 animate-crystal"
          >
            <div className="w-10 h-1 rounded-full mx-auto mb-2 opacity-30" style={{ background: 'var(--text-muted)' }} />
            <div
              className="flex items-center gap-3 pb-3 mb-1"
              style={{ borderBottom: '1px solid var(--border-soft)' }}
            >
              <div className="w-11 h-11 rounded-2xl btn-crystal flex items-center justify-center font-bold">
                {user.displayName.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-extrabold flex items-center gap-2">
                  {user.displayName}
                  <span
                    className="text-[10px] px-2 py-0.5 rounded-md"
                    style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                  >
                    {user.role === 'admin' ? '管理员' : '成员'}
                  </span>
                </div>
                <div className="text-xs font-mono-num truncate" style={{ color: 'var(--text-muted)' }}>
                  {user.username}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setUserSheetOpen(false);
                onOpenSecurity();
              }}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl text-sm font-semibold cursor-pointer"
              style={{ background: 'var(--glass-subtle)' }}
            >
              <span>🛡️ 安全与 2FA 设置</span>
              <span style={{ color: 'var(--text-muted)' }}>›</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                onToggleTheme(e);
                setUserSheetOpen(false);
              }}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl text-sm font-semibold cursor-pointer"
              style={{ background: 'var(--glass-subtle)' }}
            >
              <span>{theme === 'light' ? '🌙' : '💎'} 切换浅色 / 深色外观</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {theme === 'light' ? '浅色' : '深色'}
              </span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                onToggleGlow(e);
                setUserSheetOpen(false);
              }}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl text-sm font-semibold cursor-pointer"
              style={{ background: 'var(--glass-subtle)' }}
            >
              <span>✦ 光效强度</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {softGlow ? '柔和' : '璀璨'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setUserSheetOpen(false);
                setTrashSheetOpen(true);
              }}
              className="w-full flex items-center justify-between p-3.5 rounded-2xl text-sm font-semibold cursor-pointer"
              style={{ background: 'var(--glass-subtle)' }}
            >
              <span>🗑 回收站</span>
              <span className="text-xs font-mono-num" style={{ color: 'var(--text-muted)' }}>
                {trashPages.length}
              </span>
            </button>
            {user.role === 'admin' && (
              <button
                type="button"
                onClick={() => {
                  setUserSheetOpen(false);
                  onOpenAdmin();
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-2xl text-sm font-bold cursor-pointer"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
              >
                <span>👥 管理员控制台</span>
                <span>›</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setUserSheetOpen(false);
                onLogout();
              }}
              className="w-full p-3.5 rounded-2xl text-sm font-semibold text-rose-500 cursor-pointer text-center"
              style={{ background: 'rgba(244, 63, 94, 0.08)' }}
            >
              退出登录
            </button>
          </div>
        </div>
      )}

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
                  onScreenChange('notebooks');
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
            if (screen === 'editor') onScreenChange('pages');
          }}
        />
      )}
    </div>
  );
}
