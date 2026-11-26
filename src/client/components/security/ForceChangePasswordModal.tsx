import { type FormEvent, useState } from 'react';
import type { AuthUser } from '@shared/types';
import { ApiError, authApi } from '@client/api/client';
import { burstSparkles } from '@client/utils/effects';

interface ForceChangePasswordModalProps {
  softGlow: boolean;
  onUpdated: (user: AuthUser) => void;
  onToast: (message: string) => void;
}

export function ForceChangePasswordModal({
  softGlow,
  onUpdated,
  onToast,
}: ForceChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError('新密码长度至少为 8 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }

    setLoading(true);
    try {
      const res = await authApi.changePassword(currentPassword, newPassword);
      burstSparkles(null, softGlow);
      onToast('✦ 密码修改成功，您的账号已受保护');
      onUpdated(res.user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '修改密码失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10, 15, 35, 0.55)', backdropFilter: 'blur(10px)' }}
    >
      <div className="crystal-card w-full max-w-md rounded-3xl p-6 space-y-4 animate-crystal">
        <div>
          <h3 className="text-base font-extrabold">首次登录请设置个人密码</h3>
          <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            您的账号当前使用管理员分配的临时密码，请先修改为个人专属强密码后再继续使用。
          </p>
        </div>

        {error && (
          <div
            className="px-3.5 py-2.5 rounded-2xl text-xs font-medium"
            style={{
              background: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#f43f5e',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
              临时密码（当前密码）
            </label>
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
              style={{
                background: 'var(--glass-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
              新密码（至少 8 位）
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
              style={{
                background: 'var(--glass-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>
              确认新密码
            </label>
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
              style={{
                background: 'var(--glass-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-crystal w-full py-2.5 rounded-2xl text-sm font-semibold cursor-pointer mt-2"
          >
            {loading ? '正在保存...' : '确认修改并进入工作台'}
          </button>
        </form>
      </div>
    </div>
  );
}
