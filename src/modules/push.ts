// Push xabarlar uchun qurilma tokenlari (mijoz, kuryer, xodim) va yuborish yordamchilari.
// Ilovalar: POST /api/c/push-token, /api/k/push-token, /api/push-token  { token, platform }
import type { Ctx } from '../core/context.ts';
import * as push from '../services/push.ts';

export default function pushModule(ctx: Ctx) {
  const { db, route, ROLES, str, fail, now, tokHash } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS push_tokens (
    token TEXT PRIMARY KEY, kind TEXT NOT NULL, owner_id INTEGER NOT NULL, business_id INTEGER, role TEXT, platform TEXT, updated_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_push_owner ON push_tokens(kind, owner_id);`);

  const bearer = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; };
  const ownerBy = (table: string, col: string, req) => {
    const t = bearer(req);
    const r = t && db.prepare(`SELECT ${col} id FROM ${table} WHERE token_hash=?`).get(tokHash(t));
    return r?.id || fail(401, 'Kirish talab qilinadi');
  };
  const save = (kind: string, owner: number, body, extra: { business_id?: number; role?: string } = {}) => {
    const token = str(body.token, 'Token', { max: 4096 });
    const platform = ['android', 'ios', 'web'].includes(body.platform) ? body.platform : 'android';
    db.prepare(`INSERT INTO push_tokens (token,kind,owner_id,business_id,role,platform,updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(token) DO UPDATE SET kind=excluded.kind, owner_id=excluded.owner_id, business_id=excluded.business_id, role=excluded.role, platform=excluded.platform, updated_at=excluded.updated_at`)
      .run(token, kind, owner, extra.business_id ?? null, extra.role ?? null, platform, now());
    return { ok: true };
  };
  route('POST', '/api/c/push-token', null, ({ req, body }) => save('customer', ownerBy('app_sessions', 'user_id', req), body));
  route('POST', '/api/k/push-token', null, ({ req, body }) => save('courier', ownerBy('courier_sessions', 'courier_id', req), body));
  route('POST', '/api/push-token', ROLES.ALL, ({ user, body }) => save('staff', user.id, body, { business_id: user.business_id, role: user.role }));

  async function deliver(rows, msg: push.PushMsg) {
    try {
      const dead = await push.send(rows, msg);
      for (const t of dead) db.prepare('DELETE FROM push_tokens WHERE token=?').run(t);
    } catch (e) { console.error('Push xatosi:', e.message); }
  }
  const fire = (rows, msg) => { if (rows.length) void deliver(rows, msg); }; // javobni kutmaymiz
  return {
    toCustomer: (appUserId: number, msg: push.PushMsg) => fire(db.prepare("SELECT token FROM push_tokens WHERE kind='customer' AND owner_id=?").all(appUserId), msg),
    toCourier: (courierId: number, msg: push.PushMsg) => fire(db.prepare("SELECT token FROM push_tokens WHERE kind='courier' AND owner_id=?").all(courierId), msg),
    toStaff: (businessId: number, roles: readonly string[], msg: push.PushMsg) =>
      fire(db.prepare(`SELECT token FROM push_tokens WHERE kind='staff' AND business_id=? AND role IN (${roles.map(() => '?').join(',')})`).all(businessId, ...roles), msg),
  };
}
