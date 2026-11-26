import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import type { AuthUser, SearchResultItem } from '@shared/types';
import { authApi } from '@client/api/client';
import { BrandLogo } from '@client/components/BrandLogo';
import { AdminConsoleModal } from '@client/components/admin/AdminConsoleModal';
import { LoginPage } from '@client/components/auth/LoginPage';
import { DesktopWorkspace } from '@client/components/desktop/DesktopWorkspace';
import { type MobileScreen, MobileWorkspace } from '@client/components/mobile/MobileWorkspace';
import { QuickSearchModal } from '@client/components/search/QuickSearchModal';
import { ForceChangePasswordModal } from '@client/components/security/ForceChangePasswordModal';
import { SecurityModal } from '@client/components/security/SecurityModal';
import { useWorkspace } from '@client/stores/useWorkspace';
import {
  burstSparkles,
  triggerEntranceSheen,
  useSpecularTracking,
} from '@client/utils/effects';

type ThemeMode = 'light' | 'dark';

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>(() =>
    localStorage.getItem('airnote-theme') === 'dark' ? 'dark' : 'light',
  );
  const [softGlow, setSoftGlow] = useState<boolean>(
    () => localStorage.getItem('airnote-glow') === 'soft',
  );

  const [mobileScreen, setMobileScreen] = useState<MobileScreen>('notebooks');
  const [searchOpen, setSearchOpen] = useState(false);
  const [securityOpen, setSecurityOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useSpecularTracking();

  const showToast = useCallback((message: string) => {
    setToast(message);
  }, []);

  const workspace = useWorkspace(Boolean(user), showToast);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let active = true;
    authApi
      .me()
      .then((res) => {
        if (active) setUser(res.user);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setCheckingAuth(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!checkingAuth) {
      triggerEntranceSheen(softGlow);
    }
  }, [checkingAuth, user?.id, softGlow]);

  // Global keyboard shortcuts: ⌘K / Ctrl+K for search, Escape to close modals
  useEffect(() => {
    if (!user) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      } else if (e.key === 'Escape') {
        setSearchOpen(false);
        setSecurityOpen(false);
        setAdminOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user]);

  const toggleTheme = (evt?: MouseEvent) => {
    const next: ThemeMode = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    localStorage.setItem('airnote-theme', next);
    burstSparkles(evt, softGlow);
    showToast(next === 'dark' ? '✦ 已切换为星钻夜幕主题' : '✦ 已切换为冰晶晨露主题');
  };

  const toggleGlow = (evt?: MouseEvent) => {
    const next = !softGlow;
    setSoftGlow(next);
    localStorage.setItem('airnote-glow', next ? 'soft' : 'brilliant');
    if (!next) burstSparkles(evt, false);
    showToast(next ? '已切换为柔和光效模式' : '✦ 已切换为璀璨光效模式');
  };

  const handleLogout = async () => {
    await workspace.flushPendingSave();
    setSearchOpen(false);
    setSecurityOpen(false);
    setAdminOpen(false);
    setMobileScreen('notebooks');
    try {
      await authApi.logout();
    } catch {
      // Ignore network errors on logout and clear local session state
    }
    setUser(null);
    showToast('已安全退出 AirNote');
  };

  const handleSelectSearchPage = async (page: SearchResultItem) => {
    await workspace.jumpToPage(page.notebookId, page.sectionId, page.id);
    setMobileScreen('editor');
  };

  const rootClass = `airnote-root theme-${theme} ${softGlow ? 'glow-soft' : ''}`;

  return (
    <div className={rootClass}>
      {/* Aurora Background Layer */}
      <div className="aurora-layer" aria-hidden="true">
        <div className="aurora-orb orb-1" />
        <div className="aurora-orb orb-2" />
        <div className="aurora-orb orb-3" />
        <span className="ambient-star" style={{ top: '10%', left: '15%', fontSize: 13 }}>
          ✦
        </span>
        <span
          className="ambient-star"
          style={{ top: '22%', right: '14%', fontSize: 11, animationDelay: '1s' }}
        >
          ✧
        </span>
        <span
          className="ambient-star"
          style={{ bottom: '18%', left: '26%', fontSize: 10, animationDelay: '0.6s' }}
        >
          ✦
        </span>
      </div>

      {checkingAuth ? (
        <main className="relative z-10 flex-1 flex items-center justify-center min-h-[100dvh]">
          <div className="crystal-card rounded-3xl px-8 py-6 flex items-center gap-3 animate-crystal">
            <BrandLogo size="sm" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
              正在验证安全会话...
            </span>
          </div>
        </main>
      ) : !user ? (
        <LoginPage
          softGlow={softGlow}
          onAuthenticated={(authedUser) => {
            setMobileScreen('notebooks');
            setUser(authedUser);
          }}
          onToast={showToast}
        />
      ) : workspace.loading ? (
        <main className="relative z-10 flex-1 flex items-center justify-center min-h-[100dvh]">
          <div className="crystal-card rounded-3xl px-8 py-6 flex items-center gap-3 animate-crystal">
            <BrandLogo size="sm" />
            <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
              正在加载您的私密工作台...
            </span>
          </div>
        </main>
      ) : (
        <>
          <DesktopWorkspace
            user={user}
            workspace={workspace}
            theme={theme}
            softGlow={softGlow}
            onToggleTheme={toggleTheme}
            onToggleGlow={toggleGlow}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenSecurity={() => setSecurityOpen(true)}
            onOpenAdmin={() => setAdminOpen(true)}
            onLogout={() => void handleLogout()}
            onToast={showToast}
          />
          <MobileWorkspace
            user={user}
            workspace={workspace}
            screen={mobileScreen}
            onScreenChange={setMobileScreen}
            theme={theme}
            softGlow={softGlow}
            onToggleTheme={toggleTheme}
            onToggleGlow={toggleGlow}
            onOpenSearch={() => setSearchOpen(true)}
            onOpenSecurity={() => setSecurityOpen(true)}
            onOpenAdmin={() => setAdminOpen(true)}
            onLogout={() => void handleLogout()}
            onToast={showToast}
          />
        </>
      )}

      {/* Global Modals */}
      {user && searchOpen && (
        <QuickSearchModal
          onClose={() => setSearchOpen(false)}
          onSelectPage={(p) => void handleSelectSearchPage(p)}
        />
      )}

      {user && user.mustChangePassword && (
        <ForceChangePasswordModal
          softGlow={softGlow}
          onUpdated={(updated) => setUser(updated)}
          onToast={showToast}
        />
      )}

      {user && securityOpen && (
        <SecurityModal
          user={user}
          softGlow={softGlow}
          onClose={() => setSecurityOpen(false)}
          onUserUpdated={(updated) => setUser(updated)}
          onToast={showToast}
        />
      )}

      {user && user.role === 'admin' && adminOpen && (
        <AdminConsoleModal
          currentUser={user}
          softGlow={softGlow}
          onClose={() => setAdminOpen(false)}
          onToast={showToast}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className="fixed bottom-6 right-6 z-50 px-4 py-2.5 rounded-2xl text-xs font-semibold text-white animate-crystal"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 41, 82, 0.94), rgba(79, 70, 229, 0.94))',
            border: '1px solid rgba(255, 255, 255, 0.28)',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
