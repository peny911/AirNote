import {
  type ChangeEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Highlight } from '@tiptap/extension-highlight';
import { Image } from '@tiptap/extension-image';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { EditorContent, useEditor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import type { AttachmentItem } from '@shared/types';
import { ApiError, attachmentsApi } from '@client/api/client';
import { Callout } from '@client/components/editor/extensions/callout';
import { burstSparkles } from '@client/utils/effects';

const lowlight = createLowlight(common);

interface NoteEditorProps {
  pageId: string;
  contentJson: string;
  contentText: string;
  variant: 'desktop' | 'mobile';
  softGlow: boolean;
  onChange: (payload: { contentJson: string; contentText: string }) => void;
  onBlurSave?: () => void;
  onToast: (message: string) => void;
}

interface SlashCommandItem {
  id: string;
  label: string;
  hint: string;
  icon: string;
  keywords: string[];
  run: () => void;
}

function parseInitialContent(contentJson: string, contentText: string) {
  if (contentJson) {
    try {
      const parsed = JSON.parse(contentJson);
      if (parsed && typeof parsed === 'object' && parsed.type === 'doc') {
        return parsed;
      }
    } catch {
      // fall through to plain text conversion
    }
  }
  if (!contentText) {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
  return {
    type: 'doc',
    content: contentText.split('\n').map((line) =>
      line
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' },
    ),
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function NoteEditor({
  pageId,
  contentJson,
  contentText,
  variant,
  softGlow,
  onChange,
  onBlurSave,
  onToast,
}: NoteEditorProps) {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [uploading, setUploading] = useState(false);

  // Slash command state
  const [slashState, setSlashState] = useState<{
    open: boolean;
    query: string;
    rangeFrom: number;
    rangeTo: number;
    selectedIndex: number;
    top: number;
    left: number;
  }>({
    open: false,
    query: '',
    rangeFrom: 0,
    rangeTo: 0,
    selectedIndex: 0,
    top: 0,
    left: 0,
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadedPageIdRef = useRef<string | null>(null);
  const suppressOnUpdateRef = useRef(false);
  const pageIdRef = useRef(pageId);
  pageIdRef.current = pageId;

  const loadAttachments = useCallback(async (targetPageId: string) => {
    try {
      const res = await attachmentsApi.list(targetPageId);
      if (pageIdRef.current === targetPageId) {
        setAttachments(res.attachments);
      }
    } catch {
      // ignore transient errors
    }
  }, []);

  useEffect(() => {
    void loadAttachments(pageId);
  }, [pageId, loadAttachments]);

  const uploadFileAndInsert = useCallback(
    async (
      file: File,
      insertAsImage: boolean,
      editorInstance: ReturnType<typeof useEditor>,
    ) => {
      const currentPageId = pageIdRef.current;
      setUploading(true);
      try {
        const { attachment } = await attachmentsApi.upload(currentPageId, file);
        setAttachments((prev) => [attachment, ...prev]);

        if (insertAsImage && attachment.mimeType.startsWith('image/') && editorInstance) {
          editorInstance.chain().focus().setImage({ src: attachment.url, alt: attachment.filename }).run();
          onToast(`✦ 已上传并插入图片「${attachment.filename}」`);
        } else {
          onToast(`✦ 附件「${attachment.filename}」已上传`);
        }
      } catch (err) {
        onToast(err instanceof ApiError ? err.message : '上传附件失败，请重试');
      } finally {
        setUploading(false);
      }
    },
    [onToast],
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        heading: { levels: [1, 2, 3] },
      }),
      Placeholder.configure({
        placeholder: '随时记下此刻的想法...（输入 / 唤起快捷块菜单）',
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ inline: false, allowBase64: false }),
      Callout,
    ],
    content: parseInitialContent(contentJson, contentText),
    editorProps: {
      attributes: {
        class: `airnote-tiptap focus:outline-none ${
          variant === 'mobile' ? 'text-[16px] min-h-[260px]' : 'text-[15px] min-h-[340px]'
        }`,
      },
      handlePaste: (_view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (const item of Array.from(items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              event.preventDefault();
              void uploadFileAndInsert(file, true, editor);
              return true;
            }
          }
        }
        return false;
      },
      handleDrop: (_view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        const first = files[0];
        if (first && first.type.startsWith('image/')) {
          event.preventDefault();
          void uploadFileAndInsert(first, true, editor);
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: ed }) => {
      if (suppressOnUpdateRef.current) return;
      onChange({
        contentJson: JSON.stringify(ed.getJSON()),
        contentText: ed.getText({ blockSeparator: '\n' }),
      });

      // Detect "/" slash trigger at cursor
      const { from, empty } = ed.state.selection;
      if (!empty) {
        setSlashState((s) => (s.open ? { ...s, open: false } : s));
        return;
      }

      const $from = ed.state.selection.$from;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
      const match = textBefore.match(/(?:^|\s)\/([a-zA-Z0-9\u4e00-\u9fa5]*)$/);
      if (match && containerRef.current) {
        const query = match[1] ?? '';
        const slashStart = from - query.length - 1;
        const coords = ed.view.coordsAtPos(from);
        const box = containerRef.current.getBoundingClientRect();
        setSlashState({
          open: true,
          query,
          rangeFrom: slashStart,
          rangeTo: from,
          selectedIndex: 0,
          top: Math.max(8, coords.bottom - box.top + 6),
          left: Math.min(Math.max(0, coords.left - box.left), Math.max(0, box.width - 240)),
        });
      } else {
        setSlashState((s) => (s.open ? { ...s, open: false } : s));
      }
    },
  });

  // Sync editor content only when switching to a different page
  useEffect(() => {
    if (!editor) return;
    if (loadedPageIdRef.current === pageId) return;
    loadedPageIdRef.current = pageId;
    suppressOnUpdateRef.current = true;
    editor.commands.setContent(parseInitialContent(contentJson, contentText), {
      emitUpdate: false,
    });
    suppressOnUpdateRef.current = false;
    setSlashState((s) => (s.open ? { ...s, open: false } : s));
  }, [editor, pageId, contentJson, contentText]);

  // Sparkle burst when checking a task checkbox inside TipTap
  const handleCanvasClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      if (target.checked) {
        burstSparkles(e, softGlow);
      }
    }
  };

  const slashItems = useMemo<SlashCommandItem[]>(() => {
    if (!editor) return [];
    return [
      {
        id: 'h1',
        label: '一级标题',
        hint: 'H1',
        icon: 'H1',
        keywords: ['h1', 'heading', '标题', '一级'],
        run: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      },
      {
        id: 'h2',
        label: '二级小节',
        hint: 'H2',
        icon: 'H2',
        keywords: ['h2', 'heading', '小节', '标题'],
        run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      },
      {
        id: 'h3',
        label: '三级标题',
        hint: 'H3',
        icon: 'H3',
        keywords: ['h3', 'heading', '标题'],
        run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      },
      {
        id: 'todo',
        label: '待办清单',
        hint: 'Task',
        icon: '☑',
        keywords: ['todo', 'task', 'check', '待办', '清单'],
        run: () => editor.chain().focus().toggleTaskList().run(),
      },
      {
        id: 'bullet',
        label: '无序列表',
        hint: 'List',
        icon: '•',
        keywords: ['ul', 'bullet', 'list', '列表'],
        run: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        id: 'ordered',
        label: '有序列表',
        hint: '1.2.3',
        icon: '1.',
        keywords: ['ol', 'ordered', 'number', '有序'],
        run: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        id: 'callout',
        label: '琉璃提示卡',
        hint: 'Callout',
        icon: '💎',
        keywords: ['callout', 'tip', 'note', '提示', '卡片'],
        run: () => editor.chain().focus().toggleCallout().run(),
      },
      {
        id: 'code',
        label: '语法代码块',
        hint: 'Code',
        icon: '</>',
        keywords: ['code', 'snippet', '代码'],
        run: () => editor.chain().focus().toggleCodeBlock().run(),
      },
      {
        id: 'table',
        label: '插入表格',
        hint: '3×3',
        icon: '⊞',
        keywords: ['table', 'grid', '表格'],
        run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
      },
      {
        id: 'hr',
        label: '分割线',
        hint: 'HR',
        icon: '—',
        keywords: ['hr', 'divider', 'line', '分割线'],
        run: () => editor.chain().focus().setHorizontalRule().run(),
      },
      {
        id: 'image',
        label: '上传并插入图片',
        hint: 'Image',
        icon: '🖼',
        keywords: ['image', 'img', 'pic', '图片'],
        run: () => imageInputRef.current?.click(),
      },
      {
        id: 'file',
        label: '上传本地附件',
        hint: 'File',
        icon: '📎',
        keywords: ['file', 'attachment', 'upload', '附件'],
        run: () => fileInputRef.current?.click(),
      },
    ];
  }, [editor]);

  const filteredSlashItems = useMemo(() => {
    const q = slashState.query.trim().toLowerCase();
    if (!q) return slashItems;
    return slashItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.hint.toLowerCase().includes(q) ||
        item.keywords.some((k) => k.includes(q)),
    );
  }, [slashItems, slashState.query]);

  const executeSlashItem = useCallback(
    (item: SlashCommandItem) => {
      if (!editor) return;
      editor
        .chain()
        .focus()
        .deleteRange({ from: slashState.rangeFrom, to: slashState.rangeTo })
        .run();
      item.run();
      setSlashState((s) => ({ ...s, open: false }));
    },
    [editor, slashState.rangeFrom, slashState.rangeTo],
  );

  // Keyboard navigation while Slash Menu is open
  useEffect(() => {
    if (!slashState.open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashState((s) => ({ ...s, open: false }));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashState((s) => ({
          ...s,
          selectedIndex:
            filteredSlashItems.length > 0 ? (s.selectedIndex + 1) % filteredSlashItems.length : 0,
        }));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashState((s) => ({
          ...s,
          selectedIndex:
            filteredSlashItems.length > 0
              ? (s.selectedIndex - 1 + filteredSlashItems.length) % filteredSlashItems.length
              : 0,
        }));
      } else if (e.key === 'Enter' && filteredSlashItems.length > 0) {
        e.preventDefault();
        const chosen = filteredSlashItems[slashState.selectedIndex] ?? filteredSlashItems[0];
        if (chosen) executeSlashItem(chosen);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [slashState.open, slashState.selectedIndex, filteredSlashItems, executeSlashItem]);

  const handleFileInputChange = (e: ChangeEvent<HTMLInputElement>, asImage: boolean) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    void uploadFileAndInsert(file, asImage, editor);
  };

  const handleDeleteAttachment = async (att: AttachmentItem) => {
    try {
      await attachmentsApi.remove(att.id);
      setAttachments((prev) => prev.filter((item) => item.id !== att.id));
      onToast(`已删除附件「${att.filename}」`);
    } catch (err) {
      onToast(err instanceof ApiError ? err.message : '删除附件失败');
    }
  };

  const toolBtnStyle = (active: boolean) => ({
    background: active ? 'var(--brand-soft)' : 'transparent',
    color: active ? 'var(--brand)' : 'var(--text-secondary)',
  });

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Hidden File Inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/avif"
        className="hidden"
        onChange={(e) => handleFileInputChange(e, true)}
      />
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => handleFileInputChange(e, false)}
      />

      {/* Desktop Floating Toolbar */}
      {variant === 'desktop' && editor && (
        <div className="mb-4 flex items-center justify-center">
          <div
            className="inline-flex flex-wrap items-center gap-0.5 px-2.5 py-1.5 rounded-2xl"
            style={{
              background: 'var(--glass-elevated)',
              border: '1px solid var(--rim-outer)',
              boxShadow: '0 8px 24px -10px rgba(99, 102, 241, 0.16)',
            }}
          >
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className="px-2 py-1 rounded-lg text-xs font-bold cursor-pointer"
              style={toolBtnStyle(editor.isActive('heading', { level: 1 }))}
              title="一级标题"
            >
              H1
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className="px-2 py-1 rounded-lg text-xs font-bold cursor-pointer"
              style={toolBtnStyle(editor.isActive('heading', { level: 2 }))}
              title="二级小节"
            >
              H2
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className="px-2 py-1 rounded-lg text-xs font-bold cursor-pointer"
              style={toolBtnStyle(editor.isActive('heading', { level: 3 }))}
              title="三级标题"
            >
              H3
            </button>
            <span className="w-px h-4 mx-1" style={{ background: 'var(--border-strong)' }} />
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBold().run()}
              className="px-2 py-1 rounded-lg text-xs font-extrabold cursor-pointer"
              style={toolBtnStyle(editor.isActive('bold'))}
              title="加粗 (⌘B)"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className="px-2 py-1 rounded-lg text-xs italic cursor-pointer"
              style={toolBtnStyle(editor.isActive('italic'))}
              title="斜体 (⌘I)"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className="px-2 py-1 rounded-lg text-xs underline cursor-pointer"
              style={toolBtnStyle(editor.isActive('underline'))}
              title="下划线 (⌘U)"
            >
              U
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className="px-2 py-1 rounded-lg text-xs line-through cursor-pointer"
              style={toolBtnStyle(editor.isActive('strike'))}
              title="删除线"
            >
              S
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              className="px-2 py-1 rounded-lg text-xs font-semibold cursor-pointer"
              style={toolBtnStyle(editor.isActive('highlight'))}
              title="荧光高亮"
            >
              高亮
            </button>
            <span className="w-px h-4 mx-1" style={{ background: 'var(--border-strong)' }} />
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className="px-2 py-1 rounded-lg text-xs font-medium cursor-pointer"
              style={toolBtnStyle(editor.isActive('bulletList'))}
              title="无序列表"
            >
              • 列表
            </button>
            <button
              type="button"
              onClick={(e) => {
                editor.chain().focus().toggleTaskList().run();
                burstSparkles(e, softGlow);
              }}
              className="px-2 py-1 rounded-lg text-xs font-medium cursor-pointer"
              style={toolBtnStyle(editor.isActive('taskList'))}
              title="可勾选待办清单"
            >
              ☑ 待办
            </button>
            <button
              type="button"
              onClick={(e) => {
                editor.chain().focus().toggleCallout().run();
                burstSparkles(e, softGlow);
              }}
              className="px-2 py-1 rounded-lg text-xs font-medium cursor-pointer"
              style={toolBtnStyle(editor.isActive('callout'))}
              title="琉璃提示卡片"
            >
              💎 提示卡
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleCodeBlock().run()}
              className="px-2 py-1 rounded-lg text-xs font-medium cursor-pointer"
              style={toolBtnStyle(editor.isActive('codeBlock'))}
              title="语法代码块"
            >
              &lt;/&gt; 代码
            </button>
            <button
              type="button"
              onClick={() =>
                editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
              }
              className="px-2 py-1 rounded-lg text-xs font-medium cursor-pointer"
              style={toolBtnStyle(editor.isActive('table'))}
              title="插入 3×3 表格"
            >
              ⊞ 表格
            </button>
            <span className="w-px h-4 mx-1" style={{ background: 'var(--border-strong)' }} />
            <button
              type="button"
              disabled={uploading}
              onClick={() => imageInputRef.current?.click()}
              className="px-2 py-1 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50"
              style={{ color: 'var(--text-secondary)' }}
              title="上传并插入图片（也支持直接粘贴截图）"
            >
              🖼 图片
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="px-2 py-1 rounded-lg text-xs font-medium cursor-pointer disabled:opacity-50"
              style={{ color: 'var(--text-secondary)' }}
              title="上传本地隔离附件"
            >
              📎 附件
            </button>
          </div>
        </div>
      )}

      {/* Editor Surface + Slash Menu Anchor */}
      <div
        ref={containerRef}
        onClick={handleCanvasClick}
        className="relative flex-1"
      >
        <EditorContent editor={editor} />

        {/* Slash Command Floating Popover */}
        {slashState.open && filteredSlashItems.length > 0 && (
          <div
            className="absolute z-40 w-60 crystal-popover rounded-2xl p-1.5 space-y-0.5 animate-crystal"
            style={{ top: slashState.top, left: slashState.left }}
          >
            <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
              插入块组件
            </div>
            <div className="max-h-60 overflow-y-auto space-y-0.5">
              {filteredSlashItems.map((item, idx) => {
                const active = idx === slashState.selectedIndex;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      executeSlashItem(item);
                    }}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs cursor-pointer transition-colors"
                    style={{
                      background: active ? 'var(--brand-soft)' : 'transparent',
                      color: active ? 'var(--brand)' : 'var(--text-primary)',
                    }}
                  >
                    <span className="flex items-center gap-2 font-semibold">
                      <span className="w-5 text-center font-mono-num text-[11px]">{item.icon}</span>
                      <span>{item.label}</span>
                    </span>
                    <span className="text-[10px] font-mono-num" style={{ color: 'var(--text-muted)' }}>
                      {item.hint}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Page Isolated Attachments Strip */}
      {(attachments.length > 0 || uploading) && (
        <div
          className="mt-6 pt-4 space-y-2"
          style={{ borderTop: '1px solid var(--border-soft)' }}
        >
          <div className="flex items-center justify-between text-[11px] font-bold" style={{ color: 'var(--text-muted)' }}>
            <span>📎 本页私密附件 ({attachments.length})</span>
            {uploading && <span style={{ color: 'var(--brand)' }}>正在上传...</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl text-xs"
                style={{
                  background: 'var(--glass-subtle)',
                  border: '1px solid var(--border-soft)',
                }}
              >
                <span>{att.mimeType.startsWith('image/') ? '🖼' : '📄'}</span>
                <a
                  href={`${att.url}?download=1`}
                  className="font-semibold hover:underline max-w-[180px] truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {att.filename}
                </a>
                <span className="font-mono-num text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(att.sizeBytes)}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDeleteAttachment(att)}
                  aria-label="删除附件"
                  className="text-rose-500/80 hover:text-rose-500 cursor-pointer pl-0.5"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mobile Sticky Thumb Formatting Bar */}
      {variant === 'mobile' && editor && (
        <div
          className="fixed bottom-0 inset-x-0 z-30 px-2 py-2 flex items-center justify-around"
          style={{
            background: 'var(--glass-elevated)',
            borderTop: '1px solid var(--border-soft)',
            backdropFilter: 'blur(24px)',
            paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))',
          }}
        >
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className="px-2.5 py-2 rounded-xl text-xs font-bold cursor-pointer"
            style={toolBtnStyle(editor.isActive('heading', { level: 2 }))}
          >
            H2
          </button>
          <button
            type="button"
            onClick={(e) => {
              editor.chain().focus().toggleTaskList().run();
              burstSparkles(e, softGlow);
            }}
            className="px-2.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={toolBtnStyle(editor.isActive('taskList'))}
          >
            ☑ 待办
          </button>
          <button
            type="button"
            onClick={(e) => {
              editor.chain().focus().toggleCallout().run();
              burstSparkles(e, softGlow);
            }}
            className="px-2.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={toolBtnStyle(editor.isActive('callout'))}
          >
            💎 卡片
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className="px-2.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={toolBtnStyle(editor.isActive('codeBlock'))}
          >
            &lt;/&gt;
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => imageInputRef.current?.click()}
            className="px-2.5 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ background: 'var(--glass-subtle)' }}
            aria-label="上传图片"
          >
            🖼
          </button>
          <button
            type="button"
            onClick={() => {
              editor.commands.blur();
              onBlurSave?.();
            }}
            className="px-2.5 py-2 rounded-xl text-xs font-bold cursor-pointer"
            style={{ color: 'var(--brand)' }}
          >
            完成
          </button>
        </div>
      )}
    </div>
  );
}
