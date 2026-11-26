import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppConfig } from '../config.js';
import { type AppDeps, type AppEnv, type UserRow, jsonError, mapUserRow } from '../context.js';
import { hashToken } from '../security/crypto.js';

export const SESSION_COOKIE_NAME = 'airnote_session';

export function extractClientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = c.req.header('x-forwarded-for');
    if (xff) {
      const first = xff.split(',')[0]?.trim();
      if (first) return first;
    }
    const realIp = c.req.header('x-real-ip')?.trim();
    if (realIp) return realIp;
  }
  return c.req.header('x-test-client-ip')?.trim() || '127.0.0.1';
}

function shouldUseSecureCookie(c: Context, config: AppConfig): boolean {
  if (typeof config.cookieSecure === 'boolean') {
    return config.cookieSecure;
  }
  const forwardedProto = config.trustProxy ? c.req.header('x-forwarded-proto') : undefined;
  if (forwardedProto) {
    return forwardedProto.split(',')[0]?.trim().toLowerCase() === 'https';
  }
  try {
    return new URL(c.req.url).protocol === 'https:';
  } catch {
    return config.isProduction;
  }
}

export function setSessionCookie(c: Context, rawToken: string, config: AppConfig): void {
  setCookie(c, SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookie(c, config),
    path: '/',
    maxAge: config.sessionTtlDays * 24 * 60 * 60,
  });
}

export function clearSessionCookie(c: Context, config: AppConfig): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: shouldUseSecureCookie(c, config),
    path: '/',
  });
}

export function createSecurityHeadersMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('clientIp', extractClientIp(c, deps.config.trustProxy));
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  };
}

/**
 * CSRF 防护中间件：针对状态变更请求校验 Origin/Referer 与当前 Host 一致。
 */
export function createCsrfMiddleware(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const method = c.req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const origin = c.req.header('origin');
    if (origin) {
      const expectedHost =
        (deps.config.trustProxy ? c.req.header('x-forwarded-host') : undefined) ||
        c.req.header('host');
      if (expectedHost) {
        try {
          const originHost = new URL(origin).host;
          if (originHost !== expectedHost) {
            return jsonError(c, 403, 'CSRF_FORBIDDEN', '跨站请求已被安全策略拦截');
          }
        } catch {
          return jsonError(c, 403, 'CSRF_FORBIDDEN', '无效的请求来源');
        }
      }
    }

    return next();
  };
}

export function createRequireAuth(deps: AppDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const rawToken = getCookie(c, SESSION_COOKIE_NAME);
    if (!rawToken) {
      return jsonError(c, 401, 'UNAUTHORIZED', '请先登录后再访问');
    }

    const tokenHash = hashToken(rawToken);
    const now = Date.now();
    const row = deps.db
      .prepare(
        `SELECT s.id AS session_id, s.expires_at,
                u.id, u.username, u.display_name, u.password_hash, u.role, u.status,
                u.totp_secret_enc, u.totp_enabled, u.totp_last_step, u.must_change_password,
                u.created_at, u.last_login_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash) as (UserRow & { session_id: string; expires_at: number }) | undefined;

    if (!row) {
      clearSessionCookie(c, deps.config);
      return jsonError(c, 401, 'SESSION_INVALID', '登录会话已失效，请重新登录');
    }

    if (row.expires_at <= now) {
      deps.db.prepare('DELETE FROM sessions WHERE id = ?').run(row.session_id);
      clearSessionCookie(c, deps.config);
      return jsonError(c, 401, 'SESSION_EXPIRED', '登录会话已过期，请重新登录');
    }

    if (row.status !== 'active') {
      deps.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      clearSessionCookie(c, deps.config);
      return jsonError(c, 403, 'ACCOUNT_DISABLED', '该账号已被管理员停用');
    }

    c.set('user', mapUserRow(row));
    c.set('sessionId', row.session_id);
    return next();
  };
}
