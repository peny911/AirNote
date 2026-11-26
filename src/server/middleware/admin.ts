import type { MiddlewareHandler } from 'hono';
import { type AppEnv, jsonError } from '../context.js';

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return jsonError(c, 403, 'FORBIDDEN', '仅管理员可执行此操作');
  }
  return next();
};
