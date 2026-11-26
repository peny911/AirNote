import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GEM_COLORS,
  type NotebookItem,
  type PageDetail,
  type PageSummary,
  type SectionItem,
} from '@shared/types';
import { ApiError, notesApi } from '@client/api/client';

export type SyncStatus = 'synced' | 'dirty' | 'saving' | 'error';

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const d = new Date(ts);
  const now = new Date();
  const hhmm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (d.toDateString() === now.toDateString()) return `今天 ${hhmm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function buildContentJsonFromText(text: string): string {
  if (!text) return '{"type":"doc","content":[]}';
  const paragraphs = text.split('\n').map((line) =>
    line
      ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
      : { type: 'paragraph' },
  );
  return JSON.stringify({ type: 'doc', content: paragraphs });
}

interface PendingDraft {
  pageId: string;
  title: string;
  contentJson: string;
  contentText: string;
}

export function useWorkspace(enabled: boolean, onToast: (msg: string) => void) {
  const [loading, setLoading] = useState(true);
  const [notebooks, setNotebooks] = useState<NotebookItem[]>([]);
  const [allSections, setAllSections] = useState<SectionItem[]>([]);
  const [sections, setSections] = useState<SectionItem[]>([]);
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [pinnedPages, setPinnedPages] = useState<PageSummary[]>([]);
  const [trashPages, setTrashPages] = useState<PageSummary[]>([]);

  const [activeNotebookId, setActiveNotebookId] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<PageDetail | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');

  const pendingDraftRef = useRef<PendingDraft | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const reportError = useCallback(
    (err: unknown, fallback: string) => {
      onToast(err instanceof ApiError ? err.message : fallback);
    },
    [onToast],
  );

  const flushPendingSave = useCallback(async () => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const draft = pendingDraftRef.current;
    if (!draft) return;
    pendingDraftRef.current = null;
    setSyncStatus('saving');
    try {
      const { page } = await notesApi.updatePage(draft.pageId, {
        title: draft.title,
        contentText: draft.contentText,
        contentJson: draft.contentJson,
      });
      setSyncStatus('synced');
      setPages((prev) =>
        prev.map((p) =>
          p.id === page.id
            ? { ...p, title: page.title, preview: page.preview, updatedAt: page.updatedAt }
            : p,
        ),
      );
      setPinnedPages((prev) =>
        prev.map((p) =>
          p.id === page.id
            ? { ...p, title: page.title, preview: page.preview, updatedAt: page.updatedAt }
            : p,
        ),
      );
      setActivePage((prev) =>
        prev && prev.id === page.id ? { ...prev, updatedAt: page.updatedAt } : prev,
      );
    } catch {
      setSyncStatus('error');
    }
  }, []);

  const refreshGlobalMeta = useCallback(async () => {
    const [nbRes, allSecRes, pinRes, trashRes] = await Promise.all([
      notesApi.listNotebooks(),
      notesApi.listAllSections(),
      notesApi.listPinnedPages(),
      notesApi.listTrashPages(),
    ]);
    setNotebooks(nbRes.notebooks);
    setAllSections(allSecRes.sections);
    setPinnedPages(pinRes.pages);
    setTrashPages(trashRes.pages);
    return {
      notebooks: nbRes.notebooks,
      allSections: allSecRes.sections,
      pinnedPages: pinRes.pages,
      trashPages: trashRes.pages,
    };
  }, []);

  const loadPageDetail = useCallback(
    async (pageId: string | null) => {
      await flushPendingSave();
      setActivePageId(pageId);
      if (!pageId) {
        setActivePage(null);
        setSyncStatus('synced');
        return null;
      }
      try {
        const { page } = await notesApi.getPage(pageId);
        setActivePage(page);
        setSyncStatus('synced');
        return page;
      } catch (err) {
        reportError(err, '加载页面失败');
        return null;
      }
    },
    [flushPendingSave, reportError],
  );

  const loadSectionPages = useCallback(
    async (sectionId: string | null, preferredPageId?: string | null) => {
      await flushPendingSave();
      setActiveSectionId(sectionId);
      if (!sectionId) {
        setPages([]);
        setActivePageId(null);
        setActivePage(null);
        return [];
      }
      const { pages: nextPages } = await notesApi.listPages(sectionId);
      setPages(nextPages);
      const targetId =
        preferredPageId !== undefined
          ? preferredPageId
          : (nextPages[0]?.id ?? null);
      if (targetId && nextPages.some((p) => p.id === targetId)) {
        await loadPageDetail(targetId);
      } else {
        setActivePageId(null);
        setActivePage(null);
      }
      return nextPages;
    },
    [flushPendingSave, loadPageDetail],
  );

  const selectNotebook = useCallback(
    async (notebookId: string | null, preferredSectionId?: string | null, preferredPageId?: string | null) => {
      await flushPendingSave();
      setActiveNotebookId(notebookId);
      if (!notebookId) {
        setSections([]);
        setPages([]);
        setActiveSectionId(null);
        setActivePageId(null);
        setActivePage(null);
        return;
      }
      const { sections: nextSecs } = await notesApi.listSections(notebookId);
      setSections(nextSecs);
      const targetSecId =
        preferredSectionId && nextSecs.some((s) => s.id === preferredSectionId)
          ? preferredSectionId
          : (nextSecs[0]?.id ?? null);
      await loadSectionPages(targetSecId, preferredPageId);
    },
    [flushPendingSave, loadSectionPages],
  );

  // Initial load on authentication
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    refreshGlobalMeta()
      .then(async ({ notebooks: nbs }) => {
        if (cancelled) return;
        if (nbs.length > 0) {
          await selectNotebook(nbs[0].id);
        } else {
          setSections([]);
          setPages([]);
          setActiveNotebookId(null);
          setActiveSectionId(null);
          setActivePageId(null);
          setActivePage(null);
        }
      })
      .catch((err) => {
        if (!cancelled) reportError(err, '加载工作台数据失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshGlobalMeta, selectNotebook, reportError]);

  // Flush pending draft on unload
  useEffect(() => {
    const onBeforeUnload = () => {
      if (pendingDraftRef.current) {
        void flushPendingSave();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [flushPendingSave]);

  const updateActivePageDraft = useCallback(
    (patch: { title?: string; contentJson?: string; contentText?: string }) => {
      setActivePage((prev) => {
        if (!prev) return prev;
        const nextTitle = patch.title ?? prev.title;
        const nextText = patch.contentText ?? prev.contentText;
        const nextJson =
          patch.contentJson ??
          (patch.contentText !== undefined
            ? buildContentJsonFromText(patch.contentText)
            : prev.contentJson);
        const preview = nextText.replace(/\s+/g, ' ').trim().slice(0, 120);

        pendingDraftRef.current = {
          pageId: prev.id,
          title: nextTitle,
          contentJson: nextJson,
          contentText: nextText,
        };
        setSyncStatus('dirty');

        if (saveTimerRef.current !== null) {
          window.clearTimeout(saveTimerRef.current);
        }
        saveTimerRef.current = window.setTimeout(() => {
          void flushPendingSave();
        }, 520);

        setPages((list) =>
          list.map((p) => (p.id === prev.id ? { ...p, title: nextTitle, preview } : p)),
        );
        setPinnedPages((list) =>
          list.map((p) => (p.id === prev.id ? { ...p, title: nextTitle, preview } : p)),
        );

        return {
          ...prev,
          title: nextTitle,
          contentJson: nextJson,
          contentText: nextText,
          preview,
        };
      });
    },
    [flushPendingSave],
  );

  // ==================== CRUD Actions ====================

  const createNotebook = useCallback(
    async (input?: { name?: string; icon?: string; color?: string }) => {
      try {
        const defaultName = input?.name?.trim() || `新笔记本 ${notebooks.length + 1}`;
        const color = input?.color || GEM_COLORS[notebooks.length % GEM_COLORS.length];
        const icon = input?.icon || '📓';
        const res = await notesApi.createNotebook({
          name: defaultName,
          icon,
          color,
          createDefaultSection: true,
        });
        await refreshGlobalMeta();
        await selectNotebook(res.notebook.id, res.defaultSection?.id ?? null, null);
        onToast(`✦ 已添加笔记本「${res.notebook.name}」`);
        return res;
      } catch (err) {
        reportError(err, '添加笔记本失败');
        return null;
      }
    },
    [notebooks.length, refreshGlobalMeta, selectNotebook, onToast, reportError],
  );

  const updateNotebook = useCallback(
    async (id: string, patch: { name?: string; icon?: string; color?: string }) => {
      try {
        const { notebook } = await notesApi.updateNotebook(id, patch);
        await refreshGlobalMeta();
        onToast(`✦ 已更新笔记本「${notebook.name}」`);
        return notebook;
      } catch (err) {
        reportError(err, '更新笔记本失败');
        return null;
      }
    },
    [refreshGlobalMeta, onToast, reportError],
  );

  const deleteNotebook = useCallback(
    async (id: string) => {
      try {
        await flushPendingSave();
        await notesApi.deleteNotebook(id);
        const { notebooks: nextNbs } = await refreshGlobalMeta();
        if (activeNotebookId === id) {
          await selectNotebook(nextNbs[0]?.id ?? null);
        }
        onToast('已删除笔记本');
        return true;
      } catch (err) {
        reportError(err, '删除笔记本失败');
        return false;
      }
    },
    [activeNotebookId, flushPendingSave, refreshGlobalMeta, selectNotebook, onToast, reportError],
  );

  const createSection = useCallback(
    async (notebookId: string, input?: { name?: string; color?: string }) => {
      try {
        const nbSections = allSections.filter((s) => s.notebookId === notebookId);
        const name = input?.name?.trim() || `新分区 ${nbSections.length + 1}`;
        const color = input?.color || GEM_COLORS[nbSections.length % GEM_COLORS.length];
        const { section } = await notesApi.createSection(notebookId, { name, color });
        await refreshGlobalMeta();
        if (activeNotebookId === notebookId) {
          const { sections: nextSecs } = await notesApi.listSections(notebookId);
          setSections(nextSecs);
          await loadSectionPages(section.id, null);
        }
        onToast(`✦ 已添加分区「${section.name}」`);
        return section;
      } catch (err) {
        reportError(err, '添加分区失败');
        return null;
      }
    },
    [allSections, activeNotebookId, refreshGlobalMeta, loadSectionPages, onToast, reportError],
  );

  const updateSection = useCallback(
    async (id: string, patch: { name?: string; color?: string }) => {
      try {
        const { section } = await notesApi.updateSection(id, patch);
        await refreshGlobalMeta();
        if (activeNotebookId) {
          const { sections: nextSecs } = await notesApi.listSections(activeNotebookId);
          setSections(nextSecs);
        }
        setActivePage((prev) =>
          prev && prev.sectionId === id
            ? { ...prev, sectionName: section.name, sectionColor: section.color }
            : prev,
        );
        onToast(`✦ 已更新分区「${section.name}」`);
        return section;
      } catch (err) {
        reportError(err, '更新分区失败');
        return null;
      }
    },
    [activeNotebookId, refreshGlobalMeta, onToast, reportError],
  );

  const deleteSection = useCallback(
    async (id: string) => {
      try {
        await flushPendingSave();
        await notesApi.deleteSection(id);
        await refreshGlobalMeta();
        if (activeNotebookId) {
          const { sections: nextSecs } = await notesApi.listSections(activeNotebookId);
          setSections(nextSecs);
          if (activeSectionId === id) {
            await loadSectionPages(nextSecs[0]?.id ?? null);
          }
        }
        onToast('已删除分区');
        return true;
      } catch (err) {
        reportError(err, '删除分区失败');
        return false;
      }
    },
    [activeNotebookId, activeSectionId, flushPendingSave, refreshGlobalMeta, loadSectionPages, onToast, reportError],
  );

  const reorderSections = useCallback(
    async (notebookId: string, orderedIds: string[]) => {
      try {
        const res = await notesApi.reorderSections(notebookId, orderedIds);
        setSections(res.sections);
        await refreshGlobalMeta();
      } catch (err) {
        reportError(err, '调整分区顺序失败');
      }
    },
    [refreshGlobalMeta, reportError],
  );

  const createPage = useCallback(
    async (sectionId: string, parentPageId: string | null = null) => {
      try {
        await flushPendingSave();
        // Strictly empty title & empty body — placeholders render via input/textarea placeholder
        const { page } = await notesApi.createPage(sectionId, {
          title: '',
          parentPageId,
        });
        await refreshGlobalMeta();
        if (activeNotebookId) {
          const { sections: nextSecs } = await notesApi.listSections(activeNotebookId);
          setSections(nextSecs);
        }
        const { pages: nextPages } = await notesApi.listPages(sectionId);
        setActiveSectionId(sectionId);
        setPages(nextPages);
        setActivePageId(page.id);
        setActivePage(page);
        setSyncStatus('synced');
        onToast(parentPageId ? '✦ 已添加子页面' : '✦ 已添加页面');
        return page;
      } catch (err) {
        reportError(err, '添加页面失败');
        return null;
      }
    },
    [activeNotebookId, flushPendingSave, refreshGlobalMeta, onToast, reportError],
  );

  const togglePinPage = useCallback(
    async (pageId: string, nextPinned: boolean) => {
      try {
        const { page } = await notesApi.updatePage(pageId, { isPinned: nextPinned });
        setPages((prev) => prev.map((p) => (p.id === pageId ? { ...p, isPinned: page.isPinned } : p)));
        setActivePage((prev) => (prev && prev.id === pageId ? { ...prev, isPinned: page.isPinned } : prev));
        const { pages: nextPinnedList } = await notesApi.listPinnedPages();
        setPinnedPages(nextPinnedList);
        onToast(page.isPinned ? '★ 已星标置顶' : '已取消星标置顶');
        return page;
      } catch (err) {
        reportError(err, '切换星标状态失败');
        return null;
      }
    },
    [onToast, reportError],
  );

  const movePageToSection = useCallback(
    async (pageId: string, targetSectionId: string) => {
      try {
        await flushPendingSave();
        const { page } = await notesApi.updatePage(pageId, { sectionId: targetSectionId });
        await refreshGlobalMeta();
        if (activeNotebookId) {
          const { sections: nextSecs } = await notesApi.listSections(activeNotebookId);
          setSections(nextSecs);
        }
        if (activeSectionId) {
          const { pages: nextPages } = await notesApi.listPages(activeSectionId);
          setPages(nextPages);
          if (activePageId === pageId && activeSectionId !== targetSectionId) {
            await loadPageDetail(nextPages[0]?.id ?? null);
          }
        }
        onToast(`✦ 已移动至「${page.sectionName || '目标分区'}」`);
        return page;
      } catch (err) {
        reportError(err, '移动页面失败');
        return null;
      }
    },
    [activeNotebookId, activeSectionId, activePageId, flushPendingSave, refreshGlobalMeta, loadPageDetail, onToast, reportError],
  );

  const softDeletePage = useCallback(
    async (pageId: string) => {
      try {
        await flushPendingSave();
        await notesApi.deletePage(pageId, false);
        await refreshGlobalMeta();
        if (activeNotebookId) {
          const { sections: nextSecs } = await notesApi.listSections(activeNotebookId);
          setSections(nextSecs);
        }
        if (activeSectionId) {
          const { pages: nextPages } = await notesApi.listPages(activeSectionId);
          setPages(nextPages);
          if (activePageId === pageId) {
            await loadPageDetail(nextPages[0]?.id ?? null);
          }
        } else if (activePageId === pageId) {
          setActivePageId(null);
          setActivePage(null);
        }
        onToast('已移至回收站');
        return true;
      } catch (err) {
        reportError(err, '删除页面失败');
        return false;
      }
    },
    [activeNotebookId, activeSectionId, activePageId, flushPendingSave, refreshGlobalMeta, loadPageDetail, onToast, reportError],
  );

  const restorePage = useCallback(
    async (pageId: string) => {
      try {
        const { page } = await notesApi.updatePage(pageId, { isDeleted: false });
        await refreshGlobalMeta();
        if (activeNotebookId) {
          const { sections: nextSecs } = await notesApi.listSections(activeNotebookId);
          setSections(nextSecs);
        }
        if (activeSectionId === page.sectionId) {
          const { pages: nextPages } = await notesApi.listPages(activeSectionId);
          setPages(nextPages);
        }
        onToast(`✦ 已恢复「${page.title || '无标题页面'}」`);
        return page;
      } catch (err) {
        reportError(err, '恢复页面失败');
        return null;
      }
    },
    [activeNotebookId, activeSectionId, refreshGlobalMeta, onToast, reportError],
  );

  const permanentDeletePage = useCallback(
    async (pageId: string) => {
      try {
        await notesApi.deletePage(pageId, true);
        await refreshGlobalMeta();
        onToast('已彻底删除页面');
        return true;
      } catch (err) {
        reportError(err, '彻底删除失败');
        return false;
      }
    },
    [refreshGlobalMeta, onToast, reportError],
  );

  const emptyTrash = useCallback(async () => {
    try {
      const res = await notesApi.emptyTrash();
      await refreshGlobalMeta();
      onToast(`已清空回收站（共 ${res.deletedCount} 页）`);
      return true;
    } catch (err) {
      reportError(err, '清空回收站失败');
      return false;
    }
  }, [refreshGlobalMeta, onToast, reportError]);

  const reorderPages = useCallback(
    async (sectionId: string, orderedIds: string[]) => {
      try {
        const res = await notesApi.reorderPages(sectionId, orderedIds);
        setPages(res.pages);
      } catch (err) {
        reportError(err, '调整页面顺序失败');
      }
    },
    [reportError],
  );

  const jumpToPage = useCallback(
    async (notebookId: string, sectionId: string, pageId: string) => {
      await flushPendingSave();
      if (notebookId !== activeNotebookId) {
        await selectNotebook(notebookId, sectionId, pageId);
      } else if (sectionId !== activeSectionId) {
        await loadSectionPages(sectionId, pageId);
      } else {
        await loadPageDetail(pageId);
      }
    },
    [activeNotebookId, activeSectionId, flushPendingSave, selectNotebook, loadSectionPages, loadPageDetail],
  );

  const activeNotebook = notebooks.find((n) => n.id === activeNotebookId) ?? null;
  const activeSection = sections.find((s) => s.id === activeSectionId) ?? null;

  return {
    loading,
    notebooks,
    allSections,
    sections,
    pages,
    pinnedPages,
    trashPages,
    activeNotebookId,
    activeSectionId,
    activePageId,
    activeNotebook,
    activeSection,
    activePage,
    syncStatus,
    selectNotebook,
    loadSectionPages,
    loadPageDetail,
    jumpToPage,
    updateActivePageDraft,
    flushPendingSave,
    createNotebook,
    updateNotebook,
    deleteNotebook,
    createSection,
    updateSection,
    deleteSection,
    reorderSections,
    createPage,
    togglePinPage,
    movePageToSection,
    softDeletePage,
    restorePage,
    permanentDeletePage,
    emptyTrash,
    reorderPages,
  };
}

export type WorkspaceController = ReturnType<typeof useWorkspace>;
