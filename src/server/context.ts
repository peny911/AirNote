import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthUser, UserRole, UserStatus } from '../shared/types.js';
import type { AppConfig } from './config.js';
import type { DualDimensionRateLimiter } from './security/rate-limit.js';

export interface UserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  role: UserRole;
  status: UserStatus;
  totp_secret_enc: string | null;
  totp_enabled: number;
  totp_last_step: number | null;
  must_change_password: number;
  created_at: number;
  last_login_at: number | null;
}

export interface AppDeps {
  db: DatabaseSync;
  config: AppConfig;
  rateLimiter: DualDimensionRateLimiter;
}

export interface AppEnv {
  Variables: {
    user: AuthUser;
    sessionId: string;
    clientIp: string;
  };
}

export function mapUserRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    totpEnabled: row.totp_enabled === 1,
    mustChangePassword: row.must_change_password === 1,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
  details?: unknown,
) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
      },
    },
    status,
  );
}
