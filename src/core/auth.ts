// Xodimlar sessiyasi (PIN bilan kirish) va rollar.
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { db } from './db.ts';

export const ROLES = {
  ALL: ['admin', 'menejer', 'kassir', 'ofitsiant', 'oshpaz', 'omborchi'],
  FLOOR: ['admin', 'menejer', 'kassir', 'ofitsiant'],
  CASH: ['admin', 'menejer', 'kassir'],
  KITCHEN: ['admin', 'menejer', 'oshpaz'],
  STOP: ['admin', 'menejer', 'kassir', 'oshpaz'],
  STOCK: ['admin', 'menejer', 'omborchi'],
  REPORTS: ['admin', 'menejer'],
  MANAGE: ['admin', 'menejer'],
  ADMIN: ['admin'],
};
export type Role = (typeof ROLES.ALL)[number];
export interface User { id: number; business_id: number; name: string; role: Role; active?: number; token?: string }

db.exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, business_id INTEGER NOT NULL, created_at TEXT)');
db.prepare('DELETE FROM sessions WHERE created_at < ?').run(new Date(Date.now() - 30 * 864e5).toISOString());

export const tokHash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
/** Server qayta ishga tushsa ham sessiyalar saqlanadi (bazada token xeshi) */
export const sessions = {
  get: (t: string) => { const r = db.prepare('SELECT user_id, business_id FROM sessions WHERE token_hash=?').get(tokHash(t)); return r && { userId: r.user_id, businessId: r.business_id }; },
  set: (t: string, s: { userId: number; businessId: number }) => db.prepare('INSERT INTO sessions (token_hash,user_id,business_id,created_at) VALUES (?,?,?,?)').run(tokHash(t), s.userId, s.businessId, new Date().toISOString()),
  delete: (t: string) => db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokHash(t)),
  dropUser: (id: number) => db.prepare('DELETE FROM sessions WHERE user_id=?').run(id),
};

export function authUser(req: IncomingMessage): User | null {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = token && sessions.get(token);
  if (!s) return null;
  const user = db.prepare('SELECT id,business_id,name,role,active FROM users WHERE id=?').get(s.userId);
  if (!user || !user.active) { sessions.delete(token); return null; }
  return { ...(user as User), token };
}

export function audit(user: Record<string, any>, action: string, entity?: string, entityId?: number | null, details?: unknown) {
  db.prepare('INSERT INTO audit_log (business_id,user_id,action,entity,entity_id,details,at) VALUES (?,?,?,?,?,?,?)')
    .run(user.business_id, user.id, action, entity ?? null, entityId ?? null, details ? JSON.stringify(details) : null, new Date().toISOString());
}
