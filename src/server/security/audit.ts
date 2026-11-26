import type { DatabaseSync } from 'node:sqlite';
import { generateId } from './crypto.js';

export interface AuditLogInput {
  actorId?: string | null;
  action: string;
  targetInfo?: string | null;
  ipAddress?: string | null;
}

export function writeAuditLog(db: DatabaseSync, input: AuditLogInput): void {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, action, target_info, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    generateId(),
    input.actorId ?? null,
    input.action,
    input.targetInfo ?? null,
    input.ipAddress ?? null,
    Date.now(),
  );
}
