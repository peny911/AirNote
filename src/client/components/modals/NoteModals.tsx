import { type FormEvent, useState } from 'react';
import { GEM_COLORS, NOTEBOOK_ICONS, type NotebookItem, type SectionItem } from '@shared/types';

interface NotebookDialogProps {
  mode: 'create' | 'edit';
  initial?: NotebookItem;
  defaultColor: string;
  onClose: () => void;
  onSubmit: (data: { name: string; icon: string; color: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function NotebookDialog({
  mode,
  initial,
  defaultColor,
  onClose,
  onSubmit,
  onDelete,
}: NotebookDialogProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? '💎');
  const [color, setColor] = useState(initial?.color ?? defaultColor);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), icon, color });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10, 15, 35, 0.45)', backdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="crystal-card w-full max-w-md rounded-3xl p-6 space-y-4 animate-crystal"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-extrabold">
            {mode === 'create' ? '添加笔记本' : '编辑笔记本'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer"
            style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              笔记本名称
            </label>
            <input
              type="text"
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：个人私密备忘 / 工作项目"
              className="w-full px-4 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
              style={{
                background: 'var(--glass-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              图标
            </label>
            <div className="grid grid-cols-5 gap-2">
              {NOTEBOOK_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setIcon(ic)}
                  className="h-10 rounded-xl text-lg flex items-center justify-center cursor-pointer transition-transform active:scale-95"
                  style={{
                    background: icon === ic ? 'var(--brand-soft)' : 'var(--glass-subtle)',
                    border: icon === ic ? '1.5px solid var(--brand)' : '1px solid var(--border-soft)',
                  }}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              彩晶主题色
            </label>
            <div className="flex flex-wrap gap-2.5">
              {GEM_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`颜色 ${c}`}
                  className="w-8 h-8 rounded-full gem-facet cursor-pointer transition-transform"
                  style={{
                    ['--gem-color' as string]: c,
                    transform: color === c ? 'scale(1.18)' : 'scale(1)',
                    outline: color === c ? '2px solid var(--text-primary)' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            {mode === 'edit' && onDelete ? (
              confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onDelete();
                    onClose();
                  }}
                  className="px-3.5 py-2 rounded-2xl text-xs font-bold text-white bg-rose-500 cursor-pointer"
                >
                  确认彻底删除
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-3.5 py-2 rounded-2xl text-xs font-semibold text-rose-500 cursor-pointer"
                  style={{ background: 'rgba(244, 63, 94, 0.10)' }}
                >
                  删除笔记本
                </button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-2xl text-xs font-semibold cursor-pointer"
                style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="btn-crystal px-5 py-2 rounded-2xl text-xs font-bold cursor-pointer"
              >
                {busy ? '保存中...' : mode === 'create' ? '添加笔记本' : '保存更改'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

interface SectionDialogProps {
  mode: 'create' | 'edit';
  notebookName: string;
  initial?: SectionItem;
  defaultColor: string;
  onClose: () => void;
  onSubmit: (data: { name: string; color: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export function SectionDialog({
  mode,
  notebookName,
  initial,
  defaultColor,
  onClose,
  onSubmit,
  onDelete,
}: SectionDialogProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? defaultColor);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ name: name.trim(), color });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10, 15, 35, 0.45)', backdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="crystal-card w-full max-w-md rounded-3xl p-6 space-y-4 animate-crystal"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold">
              {mode === 'create' ? '添加分区' : '编辑分区'}
            </h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              所属笔记本：{notebookName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer"
            style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              分区名称
            </label>
            <input
              type="text"
              autoFocus
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：核心规划 / 周会纪要 / 灵感随笔"
              className="w-full px-4 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
              style={{
                background: 'var(--glass-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
              宝石色标
            </label>
            <div className="flex flex-wrap gap-2.5">
              {GEM_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`颜色 ${c}`}
                  className="w-8 h-8 rounded-full gem-facet cursor-pointer transition-transform"
                  style={{
                    ['--gem-color' as string]: c,
                    transform: color === c ? 'scale(1.18)' : 'scale(1)',
                    outline: color === c ? '2px solid var(--text-primary)' : 'none',
                    outlineOffset: 2,
                  }}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 pt-2">
            {mode === 'edit' && onDelete ? (
              confirmDelete ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onDelete();
                    onClose();
                  }}
                  className="px-3.5 py-2 rounded-2xl text-xs font-bold text-white bg-rose-500 cursor-pointer"
                >
                  确认删除分区及页面
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-3.5 py-2 rounded-2xl text-xs font-semibold text-rose-500 cursor-pointer"
                  style={{ background: 'rgba(244, 63, 94, 0.10)' }}
                >
                  删除分区
                </button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-2xl text-xs font-semibold cursor-pointer"
                style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
              >
                取消
              </button>
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="btn-crystal px-5 py-2 rounded-2xl text-xs font-bold cursor-pointer"
              >
                {busy ? '保存中...' : mode === 'create' ? '添加分区' : '保存更改'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

interface MovePageModalProps {
  pageTitle: string;
  currentSectionId: string;
  notebooks: NotebookItem[];
  allSections: SectionItem[];
  onClose: () => void;
  onSelectSection: (sectionId: string) => Promise<void>;
}

export function MovePageModal({
  pageTitle,
  currentSectionId,
  notebooks,
  allSections,
  onClose,
  onSelectSection,
}: MovePageModalProps) {
  const [busy, setBusy] = useState(false);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10, 15, 35, 0.45)', backdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="crystal-card w-full max-w-md max-h-[80dvh] flex flex-col rounded-3xl overflow-hidden animate-crystal"
      >
        <div
          className="px-5 py-4 flex items-center justify-between shrink-0"
          style={{ borderBottom: '1px solid var(--border-soft)' }}
        >
          <div className="min-w-0 pr-2">
            <h3 className="text-sm font-extrabold">移动到其他分区</h3>
            <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {pageTitle || '无标题页面'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center cursor-pointer shrink-0"
            style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {notebooks.map((nb) => {
            const nbSecs = allSections.filter((s) => s.notebookId === nb.id);
            if (nbSecs.length === 0) return null;
            return (
              <div key={nb.id} className="space-y-1.5">
                <div className="px-1 text-[11px] font-bold flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                  <span>{nb.icon}</span>
                  <span>{nb.name}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {nbSecs.map((sec) => {
                    const isCurrent = sec.id === currentSectionId;
                    return (
                      <button
                        key={sec.id}
                        type="button"
                        disabled={busy || isCurrent}
                        onClick={async () => {
                          setBusy(true);
                          await onSelectSection(sec.id);
                          onClose();
                        }}
                        className="p-3 rounded-2xl text-left cursor-pointer transition-all disabled:opacity-50"
                        style={{
                          background: isCurrent ? 'var(--brand-soft)' : 'var(--glass-subtle)',
                          border: isCurrent ? '1px solid var(--brand)' : '1px solid var(--border-soft)',
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2.5 h-2.5 rounded-full gem-facet shrink-0"
                            style={{ ['--gem-color' as string]: sec.color }}
                          />
                          <span className="text-xs font-bold truncate">{sec.name}</span>
                        </div>
                        <div className="text-[10px] mt-1 font-mono-num" style={{ color: 'var(--text-muted)' }}>
                          {isCurrent ? '当前所在分区' : `${sec.pageCount} 页`}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
