// Real-time: SSE oqimi (POS ekranlari). Token URL'da ko'rinmasligi uchun bir martalik chipta ishlatiladi.
import crypto from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { db } from './db.ts';

const streams = new Set<{ res: ServerResponse; businessId: number }>();
const tickets = new Map<string, { userId: number; exp: number }>();

export function broadcast(businessId: number, type: string, data: Record<string, unknown> = {}) {
  const msg = `event: change\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const c of streams) if (c.businessId === businessId) c.res.write(msg);
}
setInterval(() => { for (const c of streams) c.res.write(': ping\n\n'); }, 25000).unref();

export function issueTicket(userId: number) {
  const t = crypto.randomBytes(18).toString('hex');
  tickets.set(t, { userId, exp: Date.now() + 60000 });
  for (const [k, v] of tickets) if (v.exp < Date.now()) tickets.delete(k);
  return t;
}
/** Chiptani tekshirib, oqim uchun foydalanuvchini qaytaradi (chipta bir marta ishlaydi) */
export function useTicket(ticket: string) {
  const tk = tickets.get(ticket); tickets.delete(ticket);
  return tk && tk.exp > Date.now() ? db.prepare('SELECT id,business_id,name,role,active FROM users WHERE id=? AND active=1').get(tk.userId) : null;
}
export function attachStream(res: ServerResponse, businessId: number, onClose: (fn: () => void) => void) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': ok\n\n');
  const c = { res, businessId };
  streams.add(c);
  onClose(() => streams.delete(c));
}
