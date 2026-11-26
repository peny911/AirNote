import { type FormEvent, type MouseEvent, useCallback, useEffect, useState } from 'react';
import type { AdminUserItem, AuditLogItem, AuthUser, UserRole } from '@shared/types';
import { ApiError, adminApi } from '@client/api/client';
import { burstSparkles } from '@client/utils/effects';

interface AdminConsoleModalProps {
  currentUser: AuthUser;
  softGlow: boolean;
  onClose: () => void;
  onToast: (message: string) => void;
}

const ACTION_LABELS: Record<string, string> = {
  cli_init_admin: '初始化超级管理员',
  login_success: '密码登录成功',
  login_2fa_success: '2FA 登录成功',
  login_recovery_code_success: '恢复码登录成功',
  login_failed: '登录失败',
  login_blocked_disabled: '停用账号拦截',
  login_rate_limited: '登录限流拦截',
  '2fa_failed': '2FA 校验失败',
  '2fa_replay_blocked': '2FA 重放拦截',
  '2fa_rate_limited': '2FA 限流拦截',
  '2fa_enabled': '开启 2FA',
  '2fa_disabled': '关闭 2FA',
  password_changed: '自主修改密码',
  logout: '退出登录',
  admin_create_user: '管理员创建成员',
  admin_disable_user: '管理员停用成员',
  admin_enable_user: '管理员启用成员',
  admin_reset_password: '管理员重置密码',
  admin_reset_2fa: '管理员解绑 2FA',
};

function formatTime(ts: number | null): string {
  if (!ts) return '尚未登录';
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function AdminConsoleModal({
  currentUser,
  softGlow,
  onClose,
  onToast,
}: AdminConsoleModalProps) {
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('user');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One-time temporary password banner
  const [tempCredBanner, setTempCredBanner] = useState<{
    username: string;
    password: string;
    label: string;
  } | null>(null);

  // Audit logs state
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const PAGE_SIZE = 15;

  const loadUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await adminApi.listUsers();
      setUsers(res.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载成员列表失败');
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (page: number) => {
    setLogsLoading(true);
    try {
      const res = await adminApi.listAuditLogs({ page, pageSize: PAGE_SIZE });
      setLogs(res.items);
      setLogsTotal(res.total);
      setLogsPage(res.page);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载审计日志失败');
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    if (tab === 'audit') {
      void loadLogs(logsPage);
    }
  }, [tab, logsPage, loadLogs]);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await adminApi.createUser({
        username: newUsername.trim(),
        displayName: newDisplayName.trim(),
        role: newRole,
      });
      setUsers((prev) => [...prev, res.user]);
      setTempCredBanner({
        username: res.user.username,
        password: res.temporaryPassword,
        label: `成员「${res.user.displayName}」已创建`,
      });
      setNewUsername('');
      setNewDisplayName('');
      setNewRole('user');
      setShowCreate(false);
      burstSparkles(null, softGlow);
      onToast(`✦ 已创建成员 ${res.user.displayName}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建成员失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (u: AdminUserItem) => {
    setError(null);
    const nextStatus = u.status === 'active' ? 'disabled' : 'active';
    try {
      const res = await adminApi.updateUserStatus(u.id, nextStatus);
      setUsers((prev) => prev.map((item) => (item.id === u.id ? res.user : item)));
      onToast(
        nextStatus === 'disabled'
          ? `已停用 ${u.displayName} 并即时吊销其所有活跃会话`
          : `已重新启用 ${u.displayName}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '更新状态失败');
    }
  };

  const handleResetPassword = async (u: AdminUserItem, evt: MouseEvent) => {
    setError(null);
    try {
      const res = await adminApi.resetPassword(u.id);
      setTempCredBanner({
        username: u.username,
        password: res.temporaryPassword,
        label: `已为「${u.displayName}」重置临时密码`,
      });
      setUsers((prev) =>
        prev.map((item) => (item.id === u.id ? { ...item, mustChangePassword: true } : item)),
      );
      burstSparkles(evt, softGlow);
      onToast(`✦ 已重置 ${u.displayName} 的密码并踢下线`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '重置密码失败');
    }
  };

  const handleReset2fa = async (u: AdminUserItem) => {
    setError(null);
    try {
      const res = await adminApi.reset2fa(u.id);
      setUsers((prev) => prev.map((item) => (item.id === u.id ? res.user : item)));
      onToast(`已为 ${u.displayName} 解绑 2FA`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '解绑 2FA 失败');
    }
  };

  const copyTempCred = async (evt: MouseEvent) => {
    if (!tempCredBanner) return;
    try {
      await navigator.clipboard.writeText(
        `AirNote 账号：${tempCredBanner.username}\n临时密码：${tempCredBanner.password}`,
      );
      burstSparkles(evt, softGlow);
      onToast('✦ 已复制账号与临时密码');
    } catch {
      onToast('复制失败，请手动复制');
    }
  };

  const totalPages = Math.max(1, Math.ceil(logsTotal / PAGE_SIZE));

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10, 15, 35, 0.45)', backdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="crystal-card w-full max-w-2xl max-h-[88dvh] flex flex-col rounded-3xl overflow-hidden animate-crystal"
      >
        {/* Header */}
        <div
          className="px-6 py-4 flex items-center justify-between gap-3 shrink-0"
          style={{ borderBottom: '1px solid var(--border-soft)' }}
        >
          <div className="min-w-0">
            <h3 className="text-base font-extrabold truncate">AirNote 管理员控制台</h3>
            <p className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
              仅管理员可见 · 成员账号生命周期管理（严格隔离私有笔记）
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {tab === 'users' && (
              <button
                type="button"
                onClick={() => {
                  setShowCreate((prev) => !prev);
                  setError(null);
                }}
                className="btn-crystal px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
              >
                {showCreate ? '收起表单' : '+ 创建成员'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="w-9 h-9 rounded-xl flex items-center justify-center cursor-pointer"
              style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
            >
              ✕
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div
          className="px-6 py-2.5 flex items-center gap-2 shrink-0"
          style={{ borderBottom: '1px solid var(--border-soft)' }}
        >
          <button
            type="button"
            onClick={() => setTab('users')}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors"
            style={{
              background: tab === 'users' ? 'var(--brand-soft)' : 'transparent',
              color: tab === 'users' ? 'var(--brand)' : 'var(--text-secondary)',
            }}
          >
            成员管理 ({users.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('audit');
              setLogsPage(1);
            }}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors"
            style={{
              background: tab === 'audit' ? 'var(--brand-soft)' : 'transparent',
              color: tab === 'audit' ? 'var(--brand)' : 'var(--text-secondary)',
            }}
          >
            安全审计日志
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {error && (
            <div
              className="px-3.5 py-2.5 rounded-2xl text-xs font-medium"
              style={{
                background: 'rgba(244, 63, 94, 0.12)',
                border: '1px solid rgba(244, 63, 94, 0.30)',
                color: '#f43f5e',
              }}
            >
              {error}
            </div>
          )}

          {tempCredBanner && (
            <div
              className="p-4 rounded-2xl space-y-2 animate-crystal"
              style={{
                background: 'rgba(16, 185, 129, 0.10)',
                border: '1px solid rgba(16, 185, 129, 0.30)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-extrabold text-emerald-500">
                  ✦ {tempCredBanner.label}（临时密码仅显示一次）
                </span>
                <button
                  type="button"
                  onClick={() => setTempCredBanner(null)}
                  className="text-xs cursor-pointer"
                  style={{ color: 'var(--text-muted)' }}
                >
                  ✕
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono-num text-xs space-y-0.5">
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>账号：</span>
                    <strong>{tempCredBanner.username}</strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>临时密码：</span>
                    <strong className="select-all">{tempCredBanner.password}</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={copyTempCred}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  一键复制分发
                </button>
              </div>
            </div>
          )}

          {tab === 'users' ? (
            <>
              {showCreate && (
                <form
                  onSubmit={handleCreateUser}
                  className="p-4 rounded-2xl space-y-3 animate-crystal"
                  style={{
                    background: 'var(--callout-bg)',
                    border: '1px solid var(--callout-border)',
                  }}
                >
                  <div className="text-xs font-bold">创建新受邀成员（系统自动生成一次性强密码）</div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <input
                      type="text"
                      required
                      value={newDisplayName}
                      onChange={(e) => setNewDisplayName(e.target.value)}
                      placeholder="成员姓名（如：陈默）"
                      className="px-3.5 py-2 rounded-xl text-[16px] sm:text-xs outline-none"
                      style={{
                        background: 'var(--glass-input)',
                        border: '1px solid var(--border-strong)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <input
                      type="text"
                      required
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="登录账号 / 邮箱"
                      className="px-3.5 py-2 rounded-xl text-[16px] sm:text-xs outline-none"
                      style={{
                        background: 'var(--glass-input)',
                        border: '1px solid var(--border-strong)',
                        color: 'var(--text-primary)',
                      }}
                    />
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as UserRole)}
                      className="px-3.5 py-2 rounded-xl text-[16px] sm:text-xs outline-none"
                      style={{
                        background: 'var(--glass-input)',
                        border: '1px solid var(--border-strong)',
                        color: 'var(--text-primary)',
                      }}
                    >
                      <option value="user">普通成员</option>
                      <option value="admin">管理员</option>
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                      style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="btn-crystal px-4 py-1.5 rounded-xl text-xs font-bold cursor-pointer"
                    >
                      {submitting ? '创建中...' : '确认创建并生成密码'}
                    </button>
                  </div>
                </form>
              )}

              {usersLoading ? (
                <div className="py-12 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  正在加载成员列表...
                </div>
              ) : (
                <div className="space-y-2.5">
                  {users.map((u) => {
                    const isSelf = u.id === currentUser.id;
                    return (
                      <div
                        key={u.id}
                        className="p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        style={{
                          background: 'var(--glass-subtle)',
                          border: '1px solid var(--border-soft)',
                        }}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl btn-crystal flex items-center justify-center text-xs font-bold shrink-0">
                            {u.displayName.slice(0, 1)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-sm font-bold truncate">{u.displayName}</span>
                              {u.role === 'admin' && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                                >
                                  管理员
                                </span>
                              )}
                              <span
                                className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                style={{
                                  background: u.totpEnabled
                                    ? 'rgba(16, 185, 129, 0.14)'
                                    : 'var(--glass-hover)',
                                  color: u.totpEnabled ? '#10b981' : 'var(--text-muted)',
                                }}
                              >
                                {u.totpEnabled ? '2FA 已开启' : '未开 2FA'}
                              </span>
                              {u.status === 'disabled' && (
                                <span
                                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-rose-500"
                                  style={{ background: 'rgba(244, 63, 94, 0.12)' }}
                                >
                                  已停用
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono-num truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
                              {u.username} · 最近登录：{formatTime(u.lastLoginAt)}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => handleResetPassword(u, e)}
                            className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer"
                            style={{ background: 'var(--glass-input)', border: '1px solid var(--border-soft)', color: 'var(--text-secondary)' }}
                          >
                            重置密码
                          </button>
                          {u.totpEnabled && (
                            <button
                              type="button"
                              onClick={() => handleReset2fa(u)}
                              className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer"
                              style={{ background: 'rgba(245, 158, 11, 0.12)', color: '#d97706' }}
                            >
                              解绑 2FA
                            </button>
                          )}
                          {!isSelf && (
                            <button
                              type="button"
                              onClick={() => handleToggleStatus(u)}
                              className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold cursor-pointer"
                              style={{
                                background:
                                  u.status === 'active'
                                    ? 'rgba(244, 63, 94, 0.10)'
                                    : 'rgba(16, 185, 129, 0.12)',
                                color: u.status === 'active' ? '#f43f5e' : '#10b981',
                              }}
                            >
                              {u.status === 'active' ? '停用' : '启用'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <>
              {logsLoading ? (
                <div className="py-12 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  正在加载审计日志...
                </div>
              ) : logs.length === 0 ? (
                <div className="py-12 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                  暂无安全审计记录
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((item) => (
                    <div
                      key={item.id}
                      className="p-3 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-xs"
                      style={{
                        background: 'var(--glass-subtle)',
                        border: '1px solid var(--border-soft)',
                      }}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold" style={{ color: 'var(--text-primary)' }}>
                            {ACTION_LABELS[item.action] || item.action}
                          </span>
                          <span
                            className="font-mono-num text-[10px] px-1.5 py-0.5 rounded"
                            style={{ background: 'var(--glass-input)', color: 'var(--text-muted)' }}
                          >
                            {item.action}
                          </span>
                        </div>
                        <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                          操作者：{item.actorDisplayName ? `${item.actorDisplayName} (${item.actorUsername})` : '系统 / 未登录'}
                          {item.targetInfo ? ` · ${item.targetInfo}` : ''}
                        </div>
                      </div>
                      <div className="font-mono-num text-[11px] shrink-0 sm:text-right" style={{ color: 'var(--text-muted)' }}>
                        <div>{formatTime(item.createdAt)}</div>
                        <div>IP: {item.ipAddress || '-'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {logsTotal > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-2 text-xs">
                  <span style={{ color: 'var(--text-muted)' }}>
                    共 {logsTotal} 条 · 第 {logsPage} / {totalPages} 页
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={logsPage <= 1}
                      onClick={() => setLogsPage((p) => Math.max(1, p - 1))}
                      className="px-3 py-1 rounded-xl font-semibold cursor-pointer disabled:opacity-40"
                      style={{ background: 'var(--glass-subtle)' }}
                    >
                      上一页
                    </button>
                    <button
                      type="button"
                      disabled={logsPage >= totalPages}
                      onClick={() => setLogsPage((p) => Math.min(totalPages, p + 1))}
                      className="px-3 py-1 rounded-xl font-semibold cursor-pointer disabled:opacity-40"
                      style={{ background: 'var(--glass-subtle)' }}
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
