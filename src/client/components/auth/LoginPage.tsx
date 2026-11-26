import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import type { AuthUser } from '@shared/types';
import { ApiError, authApi } from '@client/api/client';
import { BrandLogo } from '@client/components/BrandLogo';
import { burstSparkles } from '@client/utils/effects';

interface LoginPageProps {
  softGlow: boolean;
  onAuthenticated: (user: AuthUser) => void;
  onToast: (message: string) => void;
}

export function LoginPage({ softGlow, onAuthenticated, onToast }: LoginPageProps) {
  const [step, setStep] = useState<'password' | '2fa'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [challengeToken, setChallengeToken] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [useRecovery, setUseRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const digitRefs = useRef<Array<HTMLInputElement | null>>([]);

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await authApi.login(username.trim(), password);
      if (res.status === 'requires_2fa') {
        setChallengeToken(res.challengeToken);
        setDigits(['', '', '', '', '', '']);
        setRecoveryCode('');
        setUseRecovery(false);
        setStep('2fa');
        window.setTimeout(() => digitRefs.current[0]?.focus(), 60);
      } else {
        burstSparkles(null, softGlow);
        onToast('✦ 欢迎回到 AirNote');
        onAuthenticated(res.user);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录请求失败，请检查网络连接');
    } finally {
      setLoading(false);
    }
  };

  const submit2fa = async (codeOverride?: string) => {
    setError(null);
    const code = useRecovery ? recoveryCode.trim() : (codeOverride ?? digits.join(''));
    if (!useRecovery && !/^\d{6}$/.test(code)) {
      setError('请输入完整的 6 位动态验证码');
      return;
    }
    if (useRecovery && code.replace(/[\s-]+/g, '').length < 8) {
      setError('请输入完整的 8 位备用恢复码');
      return;
    }

    setLoading(true);
    try {
      const res = await authApi.verify2fa(challengeToken, code, useRecovery);
      burstSparkles(null, softGlow);
      onToast(useRecovery ? '✦ 备用恢复码验证成功' : '✦ 2FA 验证通过，欢迎回到 AirNote');
      onAuthenticated(res.user);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'CHALLENGE_EXPIRED') {
        setStep('password');
      }
      setError(err instanceof ApiError ? err.message : '验证失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const handleDigitChange = (idx: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    if (!cleaned) {
      const next = [...digits];
      next[idx] = '';
      setDigits(next);
      return;
    }

    if (cleaned.length > 1) {
      const chars = cleaned.slice(0, 6).split('');
      const next = ['', '', '', '', '', ''];
      chars.forEach((ch, i) => {
        next[i] = ch;
      });
      setDigits(next);
      const focusIdx = Math.min(chars.length, 5);
      digitRefs.current[focusIdx]?.focus();
      if (chars.length === 6) {
        void submit2fa(next.join(''));
      }
      return;
    }

    const next = [...digits];
    next[idx] = cleaned;
    setDigits(next);
    if (idx < 5) {
      digitRefs.current[idx + 1]?.focus();
    } else if (next.every((d) => d.length === 1)) {
      void submit2fa(next.join(''));
    }
  };

  const handleDigitKeyDown = (idx: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      digitRefs.current[idx - 1]?.focus();
    }
  };

  const handleDigitPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length > 0) {
      e.preventDefault();
      const next = ['', '', '', '', '', ''];
      pasted.split('').forEach((ch, i) => {
        next[i] = ch;
      });
      setDigits(next);
      digitRefs.current[Math.min(pasted.length, 5)]?.focus();
      if (pasted.length === 6) {
        void submit2fa(next.join(''));
      }
    }
  };

  return (
    <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 min-h-[100dvh]">
      <div className="crystal-card specular-track w-full max-w-[420px] rounded-[32px] p-7 sm:p-8 animate-crystal">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="mb-4">
            <BrandLogo size="lg" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">AirNote</h1>
          <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
            私密、轻盈的多端云端记事本
          </p>
        </div>

        {error && (
          <div
            className="mb-4 px-3.5 py-2.5 rounded-2xl text-xs font-medium leading-relaxed animate-crystal"
            style={{
              background: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid rgba(244, 63, 94, 0.30)',
              color: '#f43f5e',
            }}
          >
            {error}
          </div>
        )}

        {step === 'password' ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                账号 / 邮箱
              </label>
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入受邀登录账号"
                className="w-full px-4 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none transition-colors"
                style={{
                  background: 'var(--glass-input)',
                  border: '1px solid var(--border-strong)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold mb-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                密码
              </label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入登录密码"
                className="w-full px-4 py-2.5 rounded-2xl text-[16px] sm:text-sm outline-none transition-colors"
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
              className="btn-crystal w-full py-3 rounded-2xl text-sm font-semibold cursor-pointer"
            >
              {loading ? '正在验证...' : '登录'}
            </button>

            <div className="text-center pt-2">
              <span
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px]"
                style={{
                  background: 'var(--glass-subtle)',
                  border: '1px solid var(--border-soft)',
                  color: 'var(--text-muted)',
                }}
              >
                🔒 仅限受邀成员使用，如需账号请联系管理员
              </span>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit2fa();
            }}
            className="space-y-5 animate-crystal"
          >
            <div
              className="p-3.5 rounded-2xl text-xs leading-relaxed"
              style={{
                background: 'var(--callout-bg)',
                border: '1px solid var(--callout-border)',
                color: 'var(--text-secondary)',
              }}
            >
              {useRecovery ? (
                <>
                  请输入开启 2FA 时保存的 <strong style={{ color: 'var(--text-primary)' }}>8 位一次性备用恢复码</strong>（使用后立即作废）。
                </>
              ) : (
                <>
                  该账号已开启 2FA，请输入{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>
                    Google / Microsoft Authenticator
                  </strong>{' '}
                  中的 6 位动态验证码。
                </>
              )}
            </div>

            {useRecovery ? (
              <input
                type="text"
                autoFocus
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder="例如：ABCD-EFGH"
                className="font-mono-num w-full px-4 py-3 rounded-2xl text-center text-[16px] sm:text-lg font-bold tracking-[0.2em] uppercase outline-none"
                style={{
                  background: 'var(--glass-input)',
                  border: '1.5px solid var(--brand)',
                  color: 'var(--text-primary)',
                }}
              />
            ) : (
              <div className="grid grid-cols-6 gap-2">
                {digits.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      digitRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={idx === 0 ? 'one-time-code' : 'off'}
                    maxLength={6}
                    value={digit}
                    onChange={(e) => handleDigitChange(idx, e.target.value)}
                    onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                    onPaste={handleDigitPaste}
                    aria-label={`验证码第 ${idx + 1} 位`}
                    className="font-mono-num h-12 rounded-2xl text-center text-[18px] font-bold outline-none transition-all"
                    style={{
                      background: 'var(--glass-input)',
                      border: digit ? '1.5px solid var(--brand)' : '1px solid var(--border-strong)',
                      color: 'var(--text-primary)',
                    }}
                  />
                ))}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep('password');
                  setError(null);
                }}
                className="px-4 py-2.5 rounded-2xl text-xs font-semibold cursor-pointer"
                style={{ background: 'var(--glass-subtle)', color: 'var(--text-secondary)' }}
              >
                返回
              </button>
              <button
                type="submit"
                disabled={loading}
                className="btn-crystal flex-1 py-2.5 rounded-2xl text-sm font-semibold cursor-pointer"
              >
                {loading ? '正在校验...' : '验证并进入'}
              </button>
            </div>

            <div className="text-center">
              <button
                type="button"
                onClick={() => {
                  setUseRecovery((prev) => !prev);
                  setError(null);
                }}
                className="text-xs font-semibold cursor-pointer hover:underline"
                style={{ color: 'var(--brand)' }}
              >
                {useRecovery ? '改用 6 位动态验证码' : '无法访问密码器？使用 8 位备用恢复码'}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
