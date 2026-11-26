import { type FormEvent, type MouseEvent, useState } from 'react';
import type { AuthUser, TotpSetupResponse } from '@shared/types';
import { ApiError, authApi } from '@client/api/client';
import { burstSparkles } from '@client/utils/effects';

interface SecurityModalProps {
  user: AuthUser;
  softGlow: boolean;
  onClose: () => void;
  onUserUpdated: (user: AuthUser) => void;
  onToast: (message: string) => void;
}

export function SecurityModal({
  user,
  softGlow,
  onClose,
  onUserUpdated,
  onToast,
}: SecurityModalProps) {
  const [setupData, setSetupData] = useState<TotpSetupResponse | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [disableMode, setDisableMode] = useState<'password' | 'totp'>('password');
  const [disableSecret, setDisableSecret] = useState('');
  const [tfaLoading, setTfaLoading] = useState(false);
  const [tfaError, setTfaError] = useState<string | null>(null);

  // Change password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  const copyText = async (text: string, label: string, evt?: MouseEvent) => {
    try {
      await navigator.clipboard.writeText(text);
      burstSparkles(evt, softGlow);
      onToast(`✦ 已复制${label}`);
    } catch {
      onToast(`复制失败，请手动选中复制${label}`);
    }
  };

  const handleToggleSwitch = async (evt: MouseEvent) => {
    setTfaError(null);
    setRecoveryCodes(null);

    if (user.totpEnabled) {
      setShowDisableForm((prev) => !prev);
      setDisableSecret('');
      return;
    }

    if (setupData) {
      setSetupData(null);
      return;
    }

    setTfaLoading(true);
    try {
      const data = await authApi.setup2fa();
      setSetupData(data);
      setConfirmCode('');
      burstSparkles(evt, softGlow);
    } catch (err) {
      setTfaError(err instanceof ApiError ? err.message : '初始化 2FA 失败');
    } finally {
      setTfaLoading(false);
    }
  };

  const handleConfirm2fa = async (e: FormEvent) => {
    e.preventDefault();
    if (!setupData) return;
    setTfaError(null);
    setTfaLoading(true);
    try {
      const res = await authApi.confirm2fa(setupData.setupToken, confirmCode.trim());
      setRecoveryCodes(res.recoveryCodes);
      setSetupData(null);
      setConfirmCode('');
      onUserUpdated({ ...user, totpEnabled: true });
      burstSparkles(null, softGlow);
      onToast('✦ 2FA 已成功开启，请保存 8 组备用恢复码');
    } catch (err) {
      setTfaError(err instanceof ApiError ? err.message : '验证码校验失败');
    } finally {
      setTfaLoading(false);
    }
  };

  const handleDisable2fa = async (e: FormEvent) => {
    e.preventDefault();
    setTfaError(null);
    setTfaLoading(true);
    try {
      const payload =
        disableMode === 'password'
          ? { currentPassword: disableSecret }
          : { totpCode: disableSecret.trim() };
      await authApi.disable2fa(payload);
      setShowDisableForm(false);
      setDisableSecret('');
      onUserUpdated({ ...user, totpEnabled: false });
      onToast('已关闭双因素认证（2FA）');
    } catch (err) {
      setTfaError(err instanceof ApiError ? err.message : '关闭 2FA 失败');
    } finally {
      setTfaLoading(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    if (newPassword.length < 8) {
      setPwdError('新密码长度至少为 8 位');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwdError('两次输入的新密码不一致');
      return;
    }

    setPwdLoading(true);
    try {
      const res = await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onUserUpdated(res.user);
      burstSparkles(null, softGlow);
      onToast('✦ 密码已更新，其他设备会话已自动注销');
    } catch (err) {
      setPwdError(err instanceof ApiError ? err.message : '修改密码失败');
    } finally {
      setPwdLoading(false);
    }
  };

  const switchOn = user.totpEnabled || Boolean(setupData);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(10, 15, 35, 0.45)', backdropFilter: 'blur(8px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="crystal-card w-full max-w-lg max-h-[88dvh] overflow-y-auto rounded-3xl p-6 space-y-5 animate-crystal"
      >
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-extrabold">安全与 2FA 设置</h3>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {user.displayName} ({user.username})
            </p>
          </div>
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

        {/* 2FA Section */}
        <section className="space-y-3">
          <div
            className="p-4 rounded-2xl flex items-center justify-between gap-3"
            style={{ background: 'var(--glass-subtle)', border: '1px solid var(--border-soft)' }}
          >
            <div>
              <div className="text-sm font-bold flex items-center gap-2">
                双因素动态验证码（2FA）
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                  style={{
                    background: user.totpEnabled
                      ? 'rgba(16, 185, 129, 0.14)'
                      : 'var(--glass-hover)',
                    color: user.totpEnabled ? '#10b981' : 'var(--text-muted)',
                  }}
                >
                  {user.totpEnabled ? '已开启' : '未开启'}
                </span>
              </div>
              <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                非强制，按需自主开启（兼容 Google / Microsoft Authenticator）
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={switchOn}
              disabled={tfaLoading}
              onClick={handleToggleSwitch}
              className={`crystal-switch shrink-0 ${switchOn ? 'on' : ''}`}
            >
              <span className="crystal-switch-knob" />
            </button>
          </div>

          {tfaError && (
            <div
              className="px-3.5 py-2.5 rounded-2xl text-xs font-medium"
              style={{
                background: 'rgba(244, 63, 94, 0.12)',
                border: '1px solid rgba(244, 63, 94, 0.30)',
                color: '#f43f5e',
              }}
            >
              {tfaError}
            </div>
          )}

          {/* Pending 2FA Setup Flow */}
          {setupData && !user.totpEnabled && (
            <div
              className="p-4 rounded-2xl space-y-4 animate-crystal"
              style={{ background: 'var(--callout-bg)', border: '1px solid var(--callout-border)' }}
            >
              <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                第 1 步：在密码器中添加 AirNote 密钥
              </div>

              {/* Desktop QR prominent */}
              <div className="hidden md:flex items-center gap-4">
                <img
                  src={setupData.qrCodeDataUrl}
                  alt="AirNote 2FA 二维码"
                  className="w-36 h-36 rounded-2xl p-1.5 bg-white shrink-0 shadow-sm"
                />
                <div className="space-y-2.5 flex-1 min-w-0 text-left">
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    使用 Google Authenticator 或 Microsoft Authenticator 扫描左侧二维码，或手动复制下方 Base32 密钥：
                  </p>
                  <div
                    className="p-2.5 rounded-xl font-mono-num text-[11px] font-bold break-all"
                    style={{ background: 'var(--glass-input)', border: '1px solid var(--border-soft)' }}
                  >
                    {setupData.secretFormatted}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => copyText(setupData.secret, ' Base32 密钥', e)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
                    style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                  >
                    一键复制密钥
                  </button>
                </div>
              </div>

              {/* Mobile: prioritize Base32 copy + otpauth:// deep link, QR collapsible */}
              <div className="md:hidden space-y-3">
                <div
                  className="p-3 rounded-2xl font-mono-num text-xs font-bold flex items-center justify-between gap-2"
                  style={{ background: 'var(--glass-input)', border: '1px solid var(--border-soft)' }}
                >
                  <span className="break-all">{setupData.secretFormatted}</span>
                  <button
                    type="button"
                    onClick={(e) => copyText(setupData.secret, ' Base32 密钥', e)}
                    className="px-2.5 py-1.5 rounded-xl text-xs font-semibold shrink-0 cursor-pointer"
                    style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                  >
                    复制密钥
                  </button>
                </div>
                <a
                  href={setupData.otpauthUri}
                  className="block w-full text-center py-2.5 rounded-2xl text-xs font-bold"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  直接唤起本机密码器 App（otpauth://）
                </a>
                <details className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <summary className="cursor-pointer select-none font-medium">
                    使用另一台设备扫码？展开二维码
                  </summary>
                  <div className="pt-3 flex justify-center">
                    <img
                      src={setupData.qrCodeDataUrl}
                      alt="AirNote 2FA 二维码"
                      className="w-40 h-40 rounded-2xl p-1.5 bg-white shadow-sm"
                    />
                  </div>
                </details>
              </div>

              <form onSubmit={handleConfirm2fa} className="space-y-2 pt-2" style={{ borderTop: '1px solid var(--border-soft)' }}>
                <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  第 2 步：输入密码器显示的 6 位实时验证码确认生效
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="输入 6 位动态码"
                    className="font-mono-num flex-1 px-3.5 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none tracking-[0.2em]"
                    style={{
                      background: 'var(--glass-input)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  <button
                    type="submit"
                    disabled={tfaLoading || confirmCode.length !== 6}
                    className="btn-crystal px-5 rounded-2xl text-xs font-bold cursor-pointer shrink-0"
                  >
                    {tfaLoading ? '校验中...' : '确认开启'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* One-time Recovery Codes display */}
          {recoveryCodes && (
            <div
              className="p-4 rounded-2xl space-y-3 animate-crystal"
              style={{
                background: 'rgba(16, 185, 129, 0.10)',
                border: '1px solid rgba(16, 185, 129, 0.30)',
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-extrabold text-emerald-500">
                    ✦ 8 组一次性备用恢复码（仅展示这一次）
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                    手机遗失时可用其中任意一组登录，请妥善离线保存。
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => copyText(recoveryCodes.join('\n'), '全部恢复码', e)}
                  className="px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 cursor-pointer"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  复制全部
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {recoveryCodes.map((code) => (
                  <div
                    key={code}
                    className="font-mono-num text-center py-2 rounded-xl text-xs font-bold tracking-wider"
                    style={{ background: 'var(--glass-input)', border: '1px solid var(--border-soft)' }}
                  >
                    {code}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Disable 2FA Verification Form */}
          {showDisableForm && user.totpEnabled && (
            <form
              onSubmit={handleDisable2fa}
              className="p-4 rounded-2xl space-y-3 animate-crystal"
              style={{
                background: 'rgba(244, 63, 94, 0.06)',
                border: '1px solid rgba(244, 63, 94, 0.24)',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-500">关闭 2FA 安全确认</span>
                <button
                  type="button"
                  onClick={() => {
                    setDisableMode((m) => (m === 'password' ? 'totp' : 'password'));
                    setDisableSecret('');
                  }}
                  className="text-[11px] font-semibold cursor-pointer"
                  style={{ color: 'var(--brand)' }}
                >
                  {disableMode === 'password' ? '改用 6 位动态码验证' : '改用登录密码验证'}
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type={disableMode === 'password' ? 'password' : 'text'}
                  inputMode={disableMode === 'totp' ? 'numeric' : undefined}
                  maxLength={disableMode === 'totp' ? 6 : 128}
                  required
                  value={disableSecret}
                  onChange={(e) =>
                    setDisableSecret(
                      disableMode === 'totp'
                        ? e.target.value.replace(/\D/g, '').slice(0, 6)
                        : e.target.value,
                    )
                  }
                  placeholder={disableMode === 'password' ? '请输入当前登录密码' : '请输入 6 位动态码'}
                  className="flex-1 px-3.5 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
                  style={{
                    background: 'var(--glass-input)',
                    border: '1px solid var(--border-strong)',
                    color: 'var(--text-primary)',
                  }}
                />
                <button
                  type="submit"
                  disabled={tfaLoading}
                  className="px-4 py-2 rounded-2xl text-xs font-bold text-white bg-rose-500 hover:bg-rose-600 cursor-pointer shrink-0"
                >
                  {tfaLoading ? '处理中...' : '确认关闭'}
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Change Password Section */}
        <section className="pt-4 space-y-3" style={{ borderTop: '1px solid var(--border-soft)' }}>
          <div>
            <h4 className="text-sm font-bold">修改登录密码</h4>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
              修改成功后会自动吊销其他设备的登录会话。
            </p>
          </div>

          {pwdError && (
            <div
              className="px-3.5 py-2.5 rounded-2xl text-xs font-medium"
              style={{
                background: 'rgba(244, 63, 94, 0.12)',
                border: '1px solid rgba(244, 63, 94, 0.30)',
                color: '#f43f5e',
              }}
            >
              {pwdError}
            </div>
          )}

          <form onSubmit={handleChangePassword} className="space-y-2.5">
            <input
              type="password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="当前密码"
              className="w-full px-3.5 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
              style={{
                background: 'var(--glass-input)',
                border: '1px solid var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <input
                type="password"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="新密码（至少 8 位）"
                className="w-full px-3.5 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
                style={{
                  background: 'var(--glass-input)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              />
              <input
                type="password"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="再次确认新密码"
                className="w-full px-3.5 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none"
                style={{
                  background: 'var(--glass-input)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pwdLoading}
                className="px-4 py-2 rounded-2xl text-xs font-bold cursor-pointer"
                style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
              >
                {pwdLoading ? '保存中...' : '更新密码'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
