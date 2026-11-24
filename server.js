// Dasturxon POS server. Ishga tushirish: node server.js  (sozlamalar: .env yoki muhit o'zgaruvchilari, config.js ga qarang)
const config = require('./config'); // .env ni boshqa modullardan oldin yuklaydi
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, hashPin } = require('./db');
const fiscal = require('./fiscal');
const printer = require('./printer');

const PORT = config.PORT;
const clientIp = (req) => (config.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress;
const PUBLIC = path.join(__dirname, 'public');
const now = () => new Date().toISOString();

const ROLES = {
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

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ---------- Sessiya va xavfsizlik ----------
db.exec('CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, business_id INTEGER NOT NULL, created_at TEXT)');
db.prepare("DELETE FROM sessions WHERE created_at < ?").run(new Date(Date.now() - 30 * 864e5).toISOString());
const tokHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
const sessions = { // server qayta ishga tushsa ham sessiyalar saqlanadi
  get: (t) => { const r = db.prepare('SELECT user_id, business_id FROM sessions WHERE token_hash=?').get(tokHash(t)); return r && { userId: r.user_id, businessId: r.business_id }; },
  set: (t, s) => db.prepare('INSERT INTO sessions (token_hash,user_id,business_id,created_at) VALUES (?,?,?,?)').run(tokHash(t), s.userId, s.businessId, new Date().toISOString()),
  delete: (t) => db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokHash(t)),
  dropUser: (id) => db.prepare('DELETE FROM sessions WHERE user_id=?').run(id),
};
const loginFails = new Map(); // ip -> { n, until }

function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  const s = token && sessions.get(token);
  if (!s) return null;
  const user = db.prepare('SELECT id,business_id,name,role,active FROM users WHERE id=?').get(s.userId);
  if (!user || !user.active) { sessions.delete(token); return null; }
  return { ...user, token };
}

// ---------- Real-time (SSE) ----------
const streams = new Set();
function broadcast(businessId, type, data = {}) {
  const msg = `event: change\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const c of streams) if (c.businessId === businessId) c.res.write(msg);
}
setInterval(() => { for (const c of streams) c.res.write(': ping\n\n'); }, 25000);

function audit(user, action, entity, entityId, details) {
  db.prepare('INSERT INTO audit_log (business_id,user_id,action,entity,entity_id,details,at) VALUES (?,?,?,?,?,?,?)')
    .run(user.business_id, user.id, action, entity, entityId ?? null, details ? JSON.stringify(details) : null, now());
}

// ---------- Yordamchilar ----------
const int = (v, name, { min = 0, max = 1e12 } = {}) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${name} noto'g'ri`);
  return n;
};
const str = (v, name, { max = 200, required = true } = {}) => {
  const s = v == null ? '' : String(v).trim();
  if (required && !s) fail(400, `${name} kiritilmagan`);
  if (s.length > max) fail(400, `${name} juda uzun`);
  return s;
};
const business = (b) => db.prepare('SELECT * FROM businesses WHERE id=?').get(b);
const currentShift = (b) => db.prepare("SELECT * FROM shifts WHERE business_id=? AND status='open'").get(b);
const needShift = (b) => currentShift(b) || fail(409, "Smena ochilmagan. Avval kassada smenani oching");

function totals(order, items) {
  const live = items.filter((i) => i.status !== 'cancelled');
  const subtotal = live.reduce((s, i) => s + (i.price + i.mod_price) * i.qty, 0);
  const discount = Math.min(subtotal, order.discount_amount + Math.round(subtotal * order.discount_percent / 100));
  const service = Math.round((subtotal - discount) * order.service_percent / 100);
  return { subtotal, discount, service, total: subtotal - discount + service };
}

function loadOrder(id, b) {
  const order = db.prepare(`SELECT o.*, t.name table_name, u.name waiter_name,
    c.name customer_name, c.phone customer_phone, c.bonus customer_bonus, c.birthday customer_birthday FROM orders o
    LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=o.waiter_id LEFT JOIN customers c ON c.id=o.customer_id
    WHERE o.id=? AND o.business_id=?`).get(id, b);
  if (!order) fail(404, 'Buyurtma topilmadi');
  order.items = db.prepare(`SELECT i.*, w.name workshop_name, p.mxik FROM order_items i
    LEFT JOIN workshops w ON w.id=i.workshop_id LEFT JOIN products p ON p.id=i.product_id
    WHERE i.order_id=? ORDER BY i.id`).all(id);
  order.payments = db.prepare('SELECT * FROM payments WHERE order_id=? ORDER BY id').all(id);
  Object.assign(order, totals(order, order.items));
  return order;
}

function editableOrder(id, user, { allowPrecheck = false } = {}) {
  const o = loadOrder(id, user.business_id);
  if (o.status !== 'open') fail(409, 'Buyurtma yopilgan');
  if (user.role === 'ofitsiant' && o.waiter_id !== user.id) fail(403, "Bu boshqa ofitsiantning buyurtmasi");
  if (o.precheck_at && !allowPrecheck && user.role === 'ofitsiant')
    fail(409, "Pre-chek chiqarilgan. O'zgartirish uchun kassir pre-chekni bekor qilishi kerak");
  return o;
}

const changedOrders = (b, id) => broadcast(b, 'orders', { id });

// ---------- Marshrutlar ----------
const routes = [];
const route = (method, pattern, roles, handler) =>
  routes.push({ method, dynamic: pattern.includes(':'), re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), roles, handler });

// Kirish
route('POST', '/api/login', null, ({ body, req }) => {
  const ip = clientIp(req);
  const f = loginFails.get(ip);
  if (f && f.until > Date.now()) fail(429, "Ko'p noto'g'ri urinish. 30 soniyadan keyin qayta urining");
  const pin = str(body.pin, 'PIN', { max: 8 });
  const biz = tenant.resolveBusiness(body.code);
  const user = db.prepare('SELECT id,business_id,name,role FROM users WHERE business_id=? AND pin_hash=? AND active=1').get(biz.id, hashPin(pin));
  if (!user) {
    const n = (f?.n || 0) + 1;
    loginFails.set(ip, { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 30000 : 0 });
    fail(401, "PIN noto'g'ri");
  }
  loginFails.delete(ip);
  tenant.assertLoginAllowed(biz.id);
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId: user.id, businessId: user.business_id });
  audit(user, 'login', 'user', user.id);
  return { token, user, business: { name: biz.name, code: biz.code } };
});
// Real-time oqim uchun bir martalik chipta (token URL'da ko'rinmasligi uchun)
const streamTickets = new Map(); // ticket -> { userId, exp }
route('POST', '/api/stream-ticket', ROLES.ALL, ({ user }) => {
  const t = crypto.randomBytes(18).toString('hex');
  streamTickets.set(t, { userId: user.id, exp: Date.now() + 60000 });
  for (const [k, v] of streamTickets) if (v.exp < Date.now()) streamTickets.delete(k);
  return { ticket: t };
});
route('POST', '/api/logout', ROLES.ALL, ({ user }) => { sessions.delete(user.token); return { ok: true }; });

// Boshlang'ich ma'lumotlar
route('GET', '/api/bootstrap', ROLES.ALL, ({ user }) => {
  const b = user.business_id;
  const q = (sql) => db.prepare(sql).all(b);
  const biz = business(b);
  return {
    user: { id: user.id, name: user.name, role: user.role },
    business: { id: biz.id, name: biz.name, code: biz.code, service_percent: biz.service_percent, receipt_footer: biz.receipt_footer,
      subscription: tenant.subStatus(b, 'pos'), delivery: tenant.subStatus(b, 'delivery'), mirror: !!biz.mirror, last_sync_at: biz.last_sync_at || null,
      ...(user.role === 'admin' ? { receipt_printer: biz.receipt_printer, fiscal_mode: biz.fiscal_mode } : {}) },
    halls: q('SELECT * FROM halls WHERE business_id=? AND active=1 ORDER BY sort,id'),
    tables: q('SELECT * FROM tables WHERE business_id=? AND active=1 ORDER BY sort,id'),
    workshops: q(`SELECT id,name,active${user.role === 'admin' ? ',printer' : ''} FROM workshops WHERE business_id=? AND active=1 ORDER BY id`),
    categories: q('SELECT * FROM categories WHERE business_id=? AND active=1 ORDER BY sort,id'),
    products: q('SELECT * FROM products WHERE business_id=? AND active=1 ORDER BY sort,id').map(imgRef),
    modifiers: q('SELECT * FROM modifiers WHERE business_id=? AND active=1 ORDER BY id'),
    users: q('SELECT id,name,role,active FROM users WHERE business_id=? ORDER BY id'),
    staff: staff.bootstrap(user),
    shift: currentShift(b) || null,
  };
});

// Buyurtmalar ro'yxati (zal holati uchun)
route('GET', '/api/orders', ROLES.ALL, ({ user, url }) => {
  const status = url.searchParams.get('status') || 'open';
  const ids = db.prepare(`SELECT id FROM orders WHERE business_id=? AND status=? ORDER BY id DESC LIMIT 300`)
    .all(user.business_id, status);
  return ids.map((r) => loadOrder(r.id, user.business_id));
});
route('GET', '/api/orders/:id', ROLES.ALL, ({ user, p }) => loadOrder(int(p.id, 'id'), user.business_id));

route('POST', '/api/orders', ROLES.FLOOR, ({ user, body }) => {
  const b = user.business_id;
  const shift = needShift(b);
  const tableId = int(body.table_id, 'Stol', { min: 1 });
  if (!db.prepare('SELECT id FROM tables WHERE id=? AND business_id=? AND active=1').get(tableId, b)) fail(404, 'Stol topilmadi');
  const guests = int(body.guests ?? 1, 'Mehmonlar soni', { min: 1, max: 200 });
  const number = db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM orders WHERE shift_id=?').get(shift.id).n;
  const id = db.prepare(`INSERT INTO orders (business_id,shift_id,number,table_id,waiter_id,guests,service_percent,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(b, shift.id, number, tableId, user.id, guests, business(b).service_percent, now()).lastInsertRowid;
  audit(user, 'order_create', 'order', id, { table_id: tableId, guests });
  changedOrders(b, id);
  return loadOrder(id, b);
});

route('PATCH', '/api/orders/:id', ROLES.FLOOR, ({ user, p, body }) => {
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  const guests = body.guests != null ? int(body.guests, 'Mehmonlar soni', { min: 1, max: 200 }) : o.guests;
  const comment = body.comment != null ? str(body.comment, 'Izoh', { required: false }) : o.comment;
  db.prepare('UPDATE orders SET guests=?, comment=? WHERE id=?').run(guests, comment, o.id);
  changedOrders(user.business_id, o.id);
  return loadOrder(o.id, user.business_id);
});

// Taom qo'shish
route('POST', '/api/orders/:id/items', ROLES.FLOOR, ({ user, p, body }) => {
  const b = user.business_id;
  const o = editableOrder(int(p.id, 'id'), user);
  const prod = db.prepare('SELECT * FROM products WHERE id=? AND business_id=? AND active=1').get(int(body.product_id, 'Taom', { min: 1 }), b);
  if (!prod) fail(404, 'Taom topilmadi');
  if (prod.in_stop) fail(409, `"${prod.name}" stop-listda`);
  const qty = int(body.qty ?? 1, 'Soni', { min: 1, max: 999 });
  const modIds = Array.isArray(body.modifier_ids) ? body.modifier_ids.map((m) => int(m, 'Modifikator')) : [];
  const mods = modIds.length
    ? db.prepare(`SELECT id,name,price FROM modifiers WHERE business_id=? AND active=1 AND id IN (${modIds.map(() => '?').join(',')})`).all(b, ...modIds)
    : [];
  const modPrice = mods.reduce((s, m) => s + m.price, 0);
  const comment = str(body.comment, 'Izoh', { required: false, max: 200 });
  // Bir xil, hali yuborilmagan pozitsiya bo'lsa - sonini oshiramiz
  const same = db.prepare(`SELECT id FROM order_items WHERE order_id=? AND product_id=? AND status='new' AND modifiers=? AND comment=?`)
    .get(o.id, prod.id, JSON.stringify(mods), comment);
  if (same) db.prepare('UPDATE order_items SET qty=qty+? WHERE id=?').run(qty, same.id);
  else db.prepare(`INSERT INTO order_items (business_id,order_id,product_id,workshop_id,name,price,mod_price,modifiers,qty,comment,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(b, o.id, prod.id, prod.workshop_id, prod.name, prod.price, modPrice, JSON.stringify(mods), qty, comment, user.id, now());
  changedOrders(b, o.id);
  return loadOrder(o.id, b);
});

// Yuborilmagan pozitsiyani o'zgartirish
route('PATCH', '/api/items/:id', ROLES.FLOOR, ({ user, p, body }) => {
  const item = db.prepare('SELECT * FROM order_items WHERE id=? AND business_id=?').get(int(p.id, 'id'), user.business_id) || fail(404, 'Pozitsiya topilmadi');
  editableOrder(item.order_id, user);
  if (item.status !== 'new') fail(409, "Oshxonaga yuborilgan taomni o'zgartirib bo'lmaydi");
  const qty = body.qty != null ? int(body.qty, 'Soni', { min: 0, max: 999 }) : item.qty;
  if (qty === 0) db.prepare('DELETE FROM order_items WHERE id=?').run(item.id);
  else db.prepare('UPDATE order_items SET qty=?, comment=? WHERE id=?')
    .run(qty, body.comment != null ? str(body.comment, 'Izoh', { required: false }) : item.comment, item.id);
  changedOrders(user.business_id, item.order_id);
  return loadOrder(item.order_id, user.business_id);
});

// Yuborilgan taomni bekor qilish (faqat kassir/admin, sabab bilan)
route('POST', '/api/items/:id/cancel', ROLES.CASH, async ({ user, p, body }) => {
  const b = user.business_id;
  const item = db.prepare('SELECT * FROM order_items WHERE id=? AND business_id=?').get(int(p.id, 'id'), b) || fail(404, 'Pozitsiya topilmadi');
  const o = editableOrder(item.order_id, user, { allowPrecheck: true });
  if (item.status === 'cancelled') fail(409, 'Allaqachon bekor qilingan');
  const reason = str(body.reason, 'Bekor qilish sababi');
  if (item.status === 'new') db.prepare('DELETE FROM order_items WHERE id=?').run(item.id);
  else {
    db.prepare("UPDATE order_items SET status='cancelled', cancel_reason=? WHERE id=?").run(reason, item.id);
    if (body.writeoff) office.writeOffCancelled(item, o, reason, user);
    const ws = db.prepare('SELECT * FROM workshops WHERE id=?').get(item.workshop_id);
    if (ws?.printer) printer.send(ws.printer, `*** BEKOR QILINDI ***\nBuyurtma #${o.number} ${o.table_name}\n${item.qty} x ${item.name}\nSabab: ${reason}`);
  }
  audit(user, 'item_cancel', 'order_item', item.id, { order: o.number, name: item.name, qty: item.qty, sum: (item.price + item.mod_price) * item.qty, was: item.status, reason, ...(body.writeoff && item.status !== 'new' ? { masalliq: 'hisobdan chiqarildi' } : {}) });
  changedOrders(b, o.id);
  return loadOrder(o.id, b);
});

// Oshxonaga yuborish (sexlar bo'yicha)
// Yangi taomlarni oshxonaga yuborish (sexlar printerlariga) — buyurtma va yetkazib berish uchun umumiy
async function sendToKitchen(o, user) {
  const b = o.business_id;
  const fresh = o.items.filter((i) => i.status === 'new');
  db.prepare("UPDATE order_items SET status='sent', sent_at=? WHERE order_id=? AND status='new'").run(now(), o.id);
  const prints = [];
  const byWs = {};
  fresh.forEach((i) => (byWs[i.workshop_id] ||= []).push(i));
  for (const [wsId, items] of Object.entries(byWs)) {
    const ws = db.prepare('SELECT * FROM workshops WHERE id=?').get(wsId);
    if (ws?.printer) {
      const r = await printer.send(ws.printer, printer.kitchenTicket({ workshop: ws.name, order: o, table: o.table_name, waiter: o.waiter_name, items }));
      prints.push({ workshop: ws.name, ...r });
    }
  }
  audit(user, 'order_send', 'order', o.id, { items: fresh.length });
  changedOrders(b, o.id);
  broadcast(b, 'kitchen');
  return prints;
}
route('POST', '/api/orders/:id/send', ROLES.FLOOR, async ({ user, p }) => {
  const o = editableOrder(int(p.id, 'id'), user);
  if (!o.items.some((i) => i.status === 'new')) fail(409, "Yuboriladigan yangi taom yo'q");
  const prints = await sendToKitchen(o, user);
  return { order: loadOrder(o.id, user.business_id), prints };
});

// Oshxona ekrani
route('GET', '/api/kitchen', ROLES.ALL, ({ user, url }) => {
  const ws = url.searchParams.get('workshop_id');
  const rows = db.prepare(`SELECT i.id,i.order_id,i.name,i.qty,i.modifiers,i.comment,i.status,i.sent_at,i.ready_at,i.workshop_id,
      o.number, o.delivery_id, t.name table_name, u.name waiter_name
    FROM order_items i JOIN orders o ON o.id=i.order_id LEFT JOIN tables t ON t.id=o.table_id LEFT JOIN users u ON u.id=o.waiter_id
    WHERE i.business_id=? AND i.status IN ('sent','cooking','ready') AND o.status IN ('open','closed')
    ${ws ? 'AND i.workshop_id=?' : ''} ORDER BY i.sent_at, i.id`).all(...[user.business_id, ...(ws ? [Number(ws)] : [])]);
  return rows;
});

const FLOW = { cooking: ['sent'], ready: ['sent', 'cooking'], served: ['ready', 'sent', 'cooking'] };
route('POST', '/api/items/:id/status', ROLES.ALL, ({ user, p, body }) => {
  const b = user.business_id;
  const item = db.prepare('SELECT * FROM order_items WHERE id=? AND business_id=?').get(int(p.id, 'id'), b) || fail(404, 'Pozitsiya topilmadi');
  const to = body.status;
  if (!FLOW[to]) fail(400, "Holat noto'g'ri");
  if (!FLOW[to].includes(item.status)) fail(409, `"${item.status}" holatidan "${to}" ga o'tib bo'lmaydi`);
  if ((to === 'cooking' || to === 'ready') && !ROLES.KITCHEN.includes(user.role)) fail(403, 'Faqat oshxona xodimi');
  if (to === 'served' && !ROLES.FLOOR.includes(user.role)) fail(403, 'Faqat zal xodimi');
  db.prepare('UPDATE order_items SET status=?, ready_at=COALESCE(ready_at, ?) WHERE id=?').run(to, to === 'ready' ? now() : null, item.id);
  changedOrders(b, item.order_id);
  broadcast(b, 'kitchen');
  if (to === 'ready') delivery.onItemReady(item.order_id, user);
  return { ok: true };
});

// Stolni ko'chirish
route('POST', '/api/orders/:id/move', ROLES.FLOOR, ({ user, p, body }) => {
  const b = user.business_id;
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  const tableId = int(body.table_id, 'Stol', { min: 1 });
  const t = db.prepare('SELECT * FROM tables WHERE id=? AND business_id=? AND active=1').get(tableId, b) || fail(404, 'Stol topilmadi');
  db.prepare('UPDATE orders SET table_id=? WHERE id=?').run(tableId, o.id);
  audit(user, 'order_move', 'order', o.id, { from: o.table_name, to: t.name });
  changedOrders(b, o.id);
  return loadOrder(o.id, b);
});

// Buyurtmalarni birlashtirish
route('POST', '/api/orders/:id/merge', ROLES.FLOOR, ({ user, p, body }) => {
  const b = user.business_id;
  const target = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  const src = editableOrder(int(body.from_order_id, 'Buyurtma'), user, { allowPrecheck: true });
  if (src.id === target.id) fail(400, "O'zi bilan birlashtirib bo'lmaydi");
  db.prepare('UPDATE order_items SET order_id=? WHERE order_id=?').run(target.id, src.id);
  db.prepare("UPDATE orders SET status='merged', closed_at=?, cancel_reason=? WHERE id=?").run(now(), `#${target.number} ga qo'shildi`, src.id);
  db.prepare('UPDATE orders SET precheck_at=NULL, guests=guests+? WHERE id=?').run(src.guests, target.id);
  audit(user, 'order_merge', 'order', target.id, { from: src.number, into: target.number });
  changedOrders(b, target.id);
  return loadOrder(target.id, b);
});

// Chekni bo'lish
route('POST', '/api/orders/:id/split', ROLES.FLOOR, ({ user, p, body }) => {
  const b = user.business_id;
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  const parts = Array.isArray(body.items) ? body.items : fail(400, 'Pozitsiyalar tanlanmagan');
  if (!parts.length) fail(400, 'Pozitsiyalar tanlanmagan');
  const number = db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM orders WHERE shift_id=?').get(o.shift_id).n;
  db.exec('BEGIN');
  try {
    const newId = db.prepare(`INSERT INTO orders (business_id,shift_id,number,table_id,waiter_id,guests,service_percent,created_at)
      VALUES (?,?,?,?,?,1,?,?)`).run(b, o.shift_id, number, o.table_id, o.waiter_id, o.service_percent, now()).lastInsertRowid;
    let moved = 0;
    for (const part of parts) {
      const it = o.items.find((i) => i.id === Number(part.id));
      if (!it || it.status === 'cancelled') continue;
      const q = int(part.qty ?? it.qty, 'Soni', { min: 1, max: it.qty });
      if (q === it.qty) db.prepare('UPDATE order_items SET order_id=? WHERE id=?').run(newId, it.id);
      else {
        db.prepare('UPDATE order_items SET qty=qty-? WHERE id=?').run(q, it.id);
        db.prepare(`INSERT INTO order_items (business_id,order_id,product_id,workshop_id,name,price,mod_price,modifiers,qty,comment,status,created_by,created_at,sent_at,ready_at)
          SELECT business_id,?,product_id,workshop_id,name,price,mod_price,modifiers,?,comment,status,created_by,created_at,sent_at,ready_at FROM order_items WHERE id=?`)
          .run(newId, q, it.id);
      }
      moved++;
    }
    if (!moved) fail(400, "Bo'lish uchun pozitsiya topilmadi");
    db.prepare('UPDATE orders SET precheck_at=NULL WHERE id IN (?,?)').run(o.id, newId);
    db.exec('COMMIT');
    audit(user, 'order_split', 'order', o.id, { new_order: number });
    changedOrders(b, o.id);
    return { from: loadOrder(o.id, b), to: loadOrder(newId, b) };
  } catch (e) { db.exec('ROLLBACK'); throw e; }
});

// Chegirma va xizmat haqi (kassir/admin)
route('POST', '/api/orders/:id/discount', ROLES.CASH, ({ user, p, body }) => {
  const b = user.business_id;
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  const percent = int(body.percent ?? 0, 'Foiz', { max: 100 });
  const amount = int(body.amount ?? 0, 'Summa');
  const reason = percent || amount ? str(body.reason, 'Chegirma sababi') : null;
  db.prepare('UPDATE orders SET discount_percent=?, discount_amount=?, discount_reason=?, precheck_at=NULL WHERE id=?').run(percent, amount, reason, o.id);
  audit(user, 'order_discount', 'order', o.id, { number: o.number, percent, amount, reason });
  changedOrders(b, o.id);
  return loadOrder(o.id, b);
});
route('POST', '/api/orders/:id/service', ROLES.CASH, ({ user, p, body }) => {
  const b = user.business_id;
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  const percent = int(body.percent, 'Xizmat haqi foizi', { max: 50 });
  db.prepare('UPDATE orders SET service_percent=?, precheck_at=NULL WHERE id=?').run(percent, o.id);
  audit(user, 'order_service', 'order', o.id, { number: o.number, from: o.service_percent, to: percent });
  changedOrders(b, o.id);
  return loadOrder(o.id, b);
});

// Pre-chek (hisob) — chiqarilgach ofitsiant o'zgartira olmaydi
route('POST', '/api/orders/:id/precheck', ROLES.FLOOR, ({ user, p }) => {
  const b = user.business_id;
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  if (o.items.some((i) => i.status === 'new')) fail(409, 'Avval barcha taomlarni oshxonaga yuboring');
  if (!o.items.some((i) => i.status !== 'cancelled')) fail(409, "Buyurtma bo'sh");
  db.prepare('UPDATE orders SET precheck_at=? WHERE id=?').run(now(), o.id);
  audit(user, 'precheck', 'order', o.id, { number: o.number, total: o.total });
  changedOrders(b, o.id);
  return loadOrder(o.id, b);
});
route('POST', '/api/orders/:id/precheck/cancel', ROLES.CASH, ({ user, p, body }) => {
  const b = user.business_id;
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  db.prepare('UPDATE orders SET precheck_at=NULL WHERE id=?').run(o.id);
  audit(user, 'precheck_cancel', 'order', o.id, { number: o.number, reason: body.reason || '' });
  changedOrders(b, o.id);
  return loadOrder(o.id, b);
});

// To'lov
const METHODS = ['naqd', 'karta', 'click', 'payme', 'onlayn', 'kuryer', 'bonus', 'zaklad']; // kuryer — platforma kuryeri olgan naqd (kassaga tushmaydi)
route('POST', '/api/orders/:id/pay', ROLES.CASH, async ({ user, p, body }) => {
  const b = user.business_id;
  const shift = needShift(b);
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  if (o.items.some((i) => i.status === 'new')) fail(409, "Oshxonaga yuborilmagan taomlar bor. Yuboring yoki o'chiring");
  if (o.total <= 0 && !o.items.some((i) => i.status !== 'cancelled')) fail(409, "Buyurtma bo'sh");
  const list = (Array.isArray(body.payments) ? body.payments : []).map((x) => ({
    method: METHODS.includes(x.method) ? x.method : fail(400, "To'lov turi noto'g'ri"),
    amount: int(x.amount, 'Summa'),
  })).filter((x) => x.amount > 0);
  if (!list.length && o.total > 0) fail(400, "To'lov summasi kiritilmagan");
  const paid = list.reduce((s, x) => s + x.amount, 0);
  const nonCash = list.filter((x) => x.method !== 'naqd').reduce((s, x) => s + x.amount, 0);
  if (paid < o.total) fail(400, `Yetarli emas: ${o.total - paid} so'm qoldi`);
  if (nonCash > o.total) fail(400, "Karta/Click/Payme/bonus summasi buyurtmadan oshib ketdi");
  const bonusPay = list.filter((x) => x.method === 'bonus').reduce((s, x) => s + x.amount, 0);
  const depositPay = list.filter((x) => x.method === 'zaklad').reduce((s, x) => s + x.amount, 0);
  if (bonusPay && (!o.customer_id || bonusPay > (o.customer_bonus || 0))) fail(400, `Bonus yetarli emas (mavjud: ${o.customer_bonus || 0})`);
  if (depositPay > (o.deposit || 0)) fail(400, `Zaklad summasi ${o.deposit || 0} dan oshmasligi kerak`);
  return closeOrder(o, list, user, shift, paid - o.total);
});

// Buyurtmani to'lovlar bilan yopish: ombor, bonus, fiskal — kassa va yetkazib berish uchun umumiy
async function closeOrder(o, list, user, shift, change = 0) {
  const b = o.business_id;
  let changeLeft = change;
  const t = now();
  db.exec('BEGIN');
  try {
    for (const x of list) {
      let amount = x.amount;
      if (x.method === 'naqd' && changeLeft > 0) { const d = Math.min(changeLeft, amount); amount -= d; changeLeft -= d; }
      if (amount > 0) db.prepare('INSERT INTO payments (business_id,order_id,shift_id,method,amount,user_id,at) VALUES (?,?,?,?,?,?,?)')
        .run(b, o.id, shift.id, x.method, amount, user.id, t);
    }
    db.prepare("UPDATE orders SET status='closed', closed_at=?, closed_by=?, shift_id=? WHERE id=?").run(t, user.id, shift.id, o.id);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  let closed = loadOrder(o.id, b);
  try { office.writeOffSale(closed, user); closed = loadOrder(o.id, b); } catch (e) { console.error('Ombor hisobdan chiqarish xatosi:', e); }
  let bonus = null;
  try { bonus = staff.afterPay(closed, user); } catch (e) { console.error('Bonus xatosi:', e); }
  const fz = await fiscal.register({ business: business(b), order: closed, items: closed.items.filter((i) => i.status !== 'cancelled'), payments: closed.payments })
    .catch((e) => ({ status: 'error', note: e.message }));
  db.prepare('UPDATE payments SET fiscal_status=?, fiscal_ref=? WHERE order_id=?').run(fz.status, fz.ref || null, o.id);
  audit(user, 'order_pay', 'order', o.id, { number: o.number, total: closed.total, payments: list, change, fiscal: fz.status });
  changedOrders(b, o.id);
  return { order: loadOrder(o.id, b), change, fiscal: fz, bonus };
}

// Buyurtmani butunlay bekor qilish
route('POST', '/api/orders/:id/cancel', ROLES.FLOOR, ({ user, p, body }) => {
  const b = user.business_id;
  const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
  const sent = o.items.some((i) => ['sent', 'cooking', 'ready', 'served'].includes(i.status));
  if (sent && !ROLES.CASH.includes(user.role)) fail(403, "Oshxonaga yuborilgan buyurtmani faqat kassir yoki admin bekor qiladi");
  const reason = sent ? str(body.reason, 'Bekor qilish sababi') : (body.reason || "bo'sh buyurtma");
  db.prepare("UPDATE order_items SET status='cancelled', cancel_reason=? WHERE order_id=? AND status!='cancelled'").run(reason, o.id);
  db.prepare("UPDATE orders SET status='cancelled', closed_at=?, closed_by=?, cancel_reason=? WHERE id=?").run(now(), user.id, reason, o.id);
  audit(user, 'order_cancel', 'order', o.id, { number: o.number, total: o.total, reason });
  changedOrders(b, o.id);
  broadcast(b, 'kitchen');
  return { ok: true };
});

// Chekni tarmoq printeriga chiqarish
route('POST', '/api/orders/:id/print', ROLES.FLOOR, async ({ user, p }) => {
  const b = user.business_id;
  const o = loadOrder(int(p.id, 'id'), b);
  const biz = business(b);
  if (!biz.receipt_printer) return { ok: false, reason: 'printer sozlanmagan' };
  const fmt = (n) => n.toLocaleString('ru-RU').replace(/ /g, ' ');
  const rows = o.items.filter((i) => i.status !== 'cancelled').map((i) => `${i.qty} x ${i.name}\n${' '.repeat(20)}${fmt((i.price + i.mod_price) * i.qty)}`);
  const text = [biz.name, o.status === 'closed' ? 'CHEK' : 'HISOB (pre-chek)', `#${o.number}  ${o.table_name || ''}`, '-'.repeat(32), ...rows, '-'.repeat(32),
    `Jami: ${fmt(o.subtotal)}`, o.discount ? `Chegirma: -${fmt(o.discount)}` : '', o.service ? `Xizmat ${o.service_percent}%: ${fmt(o.service)}` : '',
    `TO'LOV: ${fmt(o.total)} so'm`, '', biz.receipt_footer].filter(Boolean).join('\n');
  return printer.send(biz.receipt_printer, text);
});

// ---------- Smena ----------
function shiftReport(shift) {
  const b = shift.business_id;
  const byMethod = Object.fromEntries(METHODS.map((m) => [m, 0]));
  db.prepare('SELECT method, SUM(amount) s FROM payments WHERE shift_id=? GROUP BY method').all(shift.id).forEach((r) => (byMethod[r.method] = r.s));
  const moves = db.prepare('SELECT * FROM cash_moves WHERE shift_id=? ORDER BY id').all(shift.id);
  const cashIn = moves.filter((m) => m.type === 'in').reduce((s, m) => s + m.amount, 0);
  const cashOut = moves.filter((m) => m.type === 'out').reduce((s, m) => s + m.amount, 0);
  const closed = db.prepare("SELECT id FROM orders WHERE shift_id=? AND status='closed'").all(shift.id).map((r) => loadOrder(r.id, b));
  const revenue = closed.reduce((s, o) => s + o.total, 0);
  const cancelledItems = db.prepare(`SELECT i.name,i.qty,(i.price+i.mod_price)*i.qty sum,i.cancel_reason FROM order_items i JOIN orders o ON o.id=i.order_id
    WHERE o.shift_id=? AND i.status='cancelled' AND i.sent_at IS NOT NULL`).all(shift.id);
  const top = {};
  closed.forEach((o) => o.items.filter((i) => i.status !== 'cancelled').forEach((i) => {
    top[i.name] ||= { name: i.name, qty: 0, sum: 0 }; top[i.name].qty += i.qty; top[i.name].sum += (i.price + i.mod_price) * i.qty;
  }));
  return {
    shift, byMethod, revenue, orders: closed.length, avg: closed.length ? Math.round(revenue / closed.length) : 0,
    guests: closed.reduce((s, o) => s + o.guests, 0),
    discounts: closed.reduce((s, o) => s + o.discount, 0), service: closed.reduce((s, o) => s + o.service, 0),
    cashIn, cashOut, moves, expectedCash: shift.opening_cash + byMethod.naqd + cashIn - cashOut,
    cancelledItems, cancelledSum: cancelledItems.reduce((s, i) => s + i.sum, 0),
    openOrders: db.prepare("SELECT COUNT(*) c FROM orders WHERE shift_id=? AND status='open'").get(shift.id).c,
    top: Object.values(top).sort((a, z) => z.sum - a.sum).slice(0, 10),
  };
}
route('GET', '/api/shift', ROLES.CASH, ({ user }) => {
  const s = currentShift(user.business_id);
  return s ? shiftReport(s) : null;
});
route('GET', '/api/shifts', ROLES.CASH, ({ user }) =>
  db.prepare('SELECT * FROM shifts WHERE business_id=? ORDER BY id DESC LIMIT 30').all(user.business_id));
route('GET', '/api/shifts/:id', ROLES.CASH, ({ user, p }) => {
  const s = db.prepare('SELECT * FROM shifts WHERE id=? AND business_id=?').get(int(p.id, 'id'), user.business_id) || fail(404, 'Smena topilmadi');
  return shiftReport(s);
});
route('POST', '/api/shift/open', ROLES.CASH, ({ user, body }) => {
  const b = user.business_id;
  if (currentShift(b)) fail(409, 'Smena allaqachon ochiq');
  const cash = int(body.opening_cash ?? 0, "Kassadagi boshlang'ich pul");
  const id = db.prepare("INSERT INTO shifts (business_id,status,opened_by,opened_at,opening_cash) VALUES (?,'open',?,?,?)").run(b, user.id, now(), cash).lastInsertRowid;
  audit(user, 'shift_open', 'shift', id, { opening_cash: cash });
  broadcast(b, 'shift');
  return shiftReport(currentShift(b));
});
route('POST', '/api/shift/cash', ROLES.CASH, ({ user, body }) => {
  const b = user.business_id;
  const s = needShift(b);
  const type = body.type === 'in' ? 'in' : body.type === 'out' ? 'out' : fail(400, "Turi noto'g'ri");
  const amount = int(body.amount, 'Summa', { min: 1 });
  const note = str(body.note, 'Izoh');
  db.prepare('INSERT INTO cash_moves (business_id,shift_id,type,amount,note,user_id,at) VALUES (?,?,?,?,?,?,?)').run(b, s.id, type, amount, note, user.id, now());
  audit(user, 'cash_' + type, 'shift', s.id, { amount, note });
  broadcast(b, 'shift');
  return shiftReport(currentShift(b));
});
route('POST', '/api/shift/close', ROLES.CASH, ({ user, body }) => {
  const b = user.business_id;
  const s = needShift(b);
  const rep = shiftReport(s);
  if (rep.openOrders) fail(409, `${rep.openOrders} ta ochiq buyurtma bor. Avval ularni yoping`);
  const counted = int(body.counted_cash, 'Sanalgan naqd pul');
  db.prepare("UPDATE shifts SET status='closed', closed_by=?, closed_at=?, counted_cash=?, expected_cash=? WHERE id=?")
    .run(user.id, now(), counted, rep.expectedCash, s.id);
  audit(user, 'shift_close', 'shift', s.id, { expected: rep.expectedCash, counted, diff: counted - rep.expectedCash });
  broadcast(b, 'shift');
  const z = shiftReport(db.prepare('SELECT * FROM shifts WHERE id=?').get(s.id));
  staff.onShiftClose(b, z).catch((e) => console.error('Smena yopish hooki:', e));
  return z;
});

// ---------- Stop-list ----------
route('POST', '/api/products/:id/stop', ROLES.STOP, ({ user, p, body }) => {
  const b = user.business_id;
  const prod = db.prepare('SELECT * FROM products WHERE id=? AND business_id=?').get(int(p.id, 'id'), b) || fail(404, 'Taom topilmadi');
  const v = body.in_stop ? 1 : 0;
  db.prepare('UPDATE products SET in_stop=? WHERE id=?').run(v, prod.id);
  audit(user, v ? 'stop_on' : 'stop_off', 'product', prod.id, { name: prod.name });
  broadcast(b, 'menu');
  return { ok: true };
});

// ---------- Boshqaruv (admin) ----------
const ENTITIES = {
  halls: { name: 's', sort: 'i', active: 'b' },
  tables: { hall_id: 'ref:halls', name: 's', seats: 'i', sort: 'i', active: 'b' },
  workshops: { name: 's', printer: 'o', active: 'b' },
  categories: { name: 's', color: 'o', sort: 'i', active: 'b' },
  products: { category_id: 'ref:categories', workshop_id: 'ref:workshops', name: 's', price: 'i', mxik: 'o', unit: 'o', sort: 'i', in_stop: 'b', active: 'b', delivery: 'b', non_returnable: 'b', image: 'img' },
  modifiers: { name: 's', price: 'i', active: 'b' },
  users: { name: 's', role: 'role', active: 'b', pay_type: 'enum:none,hourly,monthly', rate: 'i', percent: 'i', percent_base: 'enum:sales,service' },
};
route('POST', '/api/admin/:entity', ROLES.ADMIN, ({ user, p, body }) => {
  const b = user.business_id;
  const ent = p.entity;
  const schema = ENTITIES[ent] || fail(404, "Noma'lum bo'lim");
  const id = body.id ? int(body.id, 'id', { min: 1 }) : null;
  const existing = id ? db.prepare(`SELECT * FROM ${ent} WHERE id=? AND business_id=?`).get(id, b) || fail(404, 'Topilmadi') : null;
  const vals = {};
  for (const [k, t] of Object.entries(schema)) {
    if (body[k] === undefined) { if (!existing && (t === 's' || t.startsWith('ref') || t === 'role')) fail(400, `${k} kiritilmagan`); continue; }
    if (t === 's') vals[k] = str(body[k], k);
    else if (t === 'o') vals[k] = str(body[k], k, { required: false });
    else if (t === 'i') vals[k] = int(body[k], k);
    else if (t === 'b') vals[k] = body[k] ? 1 : 0;
    else if (t === 'role') vals[k] = ROLES.ALL.includes(body[k]) ? body[k] : fail(400, "Rol noto'g'ri");
    else if (t.startsWith('enum:')) vals[k] = t.slice(5).split(',').includes(body[k]) ? body[k] : fail(400, `${k} noto'g'ri`);
    else if (t === 'img') { // kichraytirilgan rasm (data URL), 300 KB gacha
      const v = String(body[k] || '');
      if (v && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v) || v.length > 300000)) fail(400, "Rasm noto'g'ri yoki juda katta");
      vals[k] = v;
    }
    else if (t.startsWith('ref:')) {
      const refT = t.slice(4);
      vals[k] = int(body[k], k, { min: 1 });
      if (!db.prepare(`SELECT id FROM ${refT} WHERE id=? AND business_id=?`).get(vals[k], b)) fail(400, `${k} topilmadi`);
    }
  }
  if (ent === 'users') {
    if (body.pin != null && body.pin !== '') {
      const pin = String(body.pin);
      if (!/^\d{4}$/.test(pin)) fail(400, "PIN 4 ta raqam bo'lishi kerak");
      const clash = db.prepare('SELECT id FROM users WHERE pin_hash=? AND business_id=? AND id!=?').get(hashPin(pin), b, id || 0);
      if (clash) fail(409, 'Bu PIN band. Boshqasini tanlang');
      vals.pin_hash = hashPin(pin);
    } else if (!existing) fail(400, 'PIN kiritilmagan');
    const removingAdmin = existing && existing.role === 'admin' && (vals.role && vals.role !== 'admin' || vals.active === 0);
    if (removingAdmin && db.prepare("SELECT COUNT(*) c FROM users WHERE business_id=? AND role='admin' AND active=1").get(b).c <= 1)
      fail(409, "Oxirgi adminni o'chirib yoki o'zgartirib bo'lmaydi");
    if (vals.active === 0) sessions.dropUser(id);
  }
  const keys = Object.keys(vals);
  let rowId = id;
  if (existing) { if (keys.length) db.prepare(`UPDATE ${ent} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=?`).run(...keys.map((k) => vals[k]), id); }
  else rowId = db.prepare(`INSERT INTO ${ent} (business_id,${keys.join(',')}) VALUES (?,${keys.map(() => '?').join(',')})`).run(b, ...keys.map((k) => vals[k])).lastInsertRowid;
  const logVals = { ...vals }; delete logVals.pin_hash;
  audit(user, existing ? 'update' : 'create', ent, rowId, { ...logVals, ...(vals.pin_hash ? { pin: 'yangilandi' } : {}) });
  broadcast(b, 'menu');
  const row = db.prepare(`SELECT * FROM ${ent} WHERE id=?`).get(rowId);
  delete row.pin_hash;
  return row;
});
route('GET', '/api/admin/:entity', ROLES.ADMIN, ({ user, p }) => {
  if (!ENTITIES[p.entity]) fail(404, "Noma'lum bo'lim");
  const rows = db.prepare(`SELECT * FROM ${p.entity} WHERE business_id=? ORDER BY active DESC, ${p.entity === 'users' ? 'id' : 'sort, id'}`)
    .all(user.business_id).map((r) => (delete r.pin_hash, p.entity === 'products' ? imgRef(r) : r));
  return rows;
});
route('POST', '/api/admin/settings', ROLES.ADMIN, ({ user, body }) => {
  const b = user.business_id;
  const biz = business(b);
  const name = body.name != null ? str(body.name, 'Nomi') : biz.name;
  const sp = body.service_percent != null ? int(body.service_percent, 'Xizmat haqi', { max: 50 }) : biz.service_percent;
  const rp = body.receipt_printer != null ? str(body.receipt_printer, 'Printer', { required: false }) : biz.receipt_printer;
  const rf = body.receipt_footer != null ? str(body.receipt_footer, 'Chek matni', { required: false }) : biz.receipt_footer;
  const fm = body.fiscal_mode != null ? (['off', 'mock'].includes(body.fiscal_mode) ? body.fiscal_mode : fail(400, "Fiskal rejim noto'g'ri")) : biz.fiscal_mode;
  db.prepare('UPDATE businesses SET name=?,service_percent=?,receipt_printer=?,receipt_footer=?,fiscal_mode=? WHERE id=?').run(name, sp, rp, rf, fm, b);
  audit(user, 'settings', 'business', b, { name, service_percent: sp, fiscal_mode: fm });
  broadcast(b, 'menu');
  return business(b);
});
route('GET', '/api/audit', ROLES.MANAGE, ({ user, url }) => {
  const action = url.searchParams.get('action');
  return db.prepare(`SELECT a.*, u.name user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    WHERE a.business_id=? ${action ? 'AND a.action=?' : ''} ORDER BY a.id DESC LIMIT 300`).all(...[user.business_id, ...(action ? [action] : [])]);
});

// ---------- 2-etap: Ofis (ombor, texkartalar, hisobotlar) ----------
const office = require('./office')({ db, route, ROLES, int, str, fail, audit, broadcast, now, currentShift });

// ---------- 3-etap: Xodimlar va mijozlar ----------
const staff = require('./staff')({ db, route, ROLES, int, str, fail, audit, broadcast, now, currentShift, loadOrder, editableOrder, business, shiftReport, office, METHODS });

// ---------- 4-etap: Ko'p biznes, obuna, platforma ----------
const tenant = require('./tenant')({ db, route, int, str, fail, now, clientIp });

// ---------- 5-etap: Lokal ↔ bulut sinxronizatsiya ----------
const sync = require('./sync')({ db, route, ROLES, int, str, fail, audit, now, tenant, config });

// ---------- 6-etap: Yetkazib berish (mijoz ilovasi) ----------
const delivery = require('./delivery')({ db, route, ROLES, int, str, fail, audit, broadcast, now, currentShift, needShift, loadOrder, business,
  sendToKitchen, closeOrder, tenant, sync, office, config, clientIp, imgRef });
require('./courier')({ db, route, int, str, fail, now, tenant, broadcast, dlv: delivery }); // 7-etap: kuryerlar
require('./platform')({ db, route, ROLES, int, str, fail, audit, now, tenant, broadcast, dlv: delivery }); // 8-etap: platforma admin

// ---------- HTTP server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

// Mahsulot rasmi: bazada data URL, tashqariga oddiy rasm sifatida (kesh bilan) — bootstrap/menyu yengil bo'ladi
const imgVer = (data) => require('crypto').createHash('md5').update(data).digest('hex').slice(0, 10);
function imgRef(r) { const { image, ...rest } = r; return { ...rest, image: image ? `/img/p/${r.id}?v=${imgVer(image)}` : '' }; }
function serveImage(res, id) {
  const r = db.prepare('SELECT image FROM products WHERE id=?').get(Number(id));
  const m = r?.image && /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/.exec(r.image);
  if (!m) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=604800, immutable' });
  res.end(Buffer.from(m[2], 'base64'));
}
function serveStatic(req, res, pathname) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
    file = ['app', 'courier'].map((d) => (pathname === '/' + d || pathname.startsWith(`/${d}/`) ? path.join(PUBLIC, d, 'index.html') : null)).find(Boolean) || path.join(PUBLIC, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > limit) { reject(new HttpError(413, 'Juda katta so\'rov')); req.destroy(); } });
    req.on('end', () => {
      try {
        if (/application\/x-www-form-urlencoded/.test(req.headers['content-type'] || '')) return resolve(Object.fromEntries(new URLSearchParams(data))); // Click callbacklari
        resolve(data ? JSON.parse(data) : {});
      } catch { reject(new HttpError(400, "JSON noto'g'ri")); }
    });
    req.on('error', reject);
  });
}

const rate = new Map(); // ip -> { n, reset }
setInterval(() => { const t = Date.now(); for (const [k, v] of rate) if (v.reset < t) rate.delete(k); }, 60000).unref();
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if (config.MODE === 'cloud') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  const ip = clientIp(req);
  const rl = rate.get(ip) || { n: 0, reset: Date.now() + 60000 };
  if (rl.reset < Date.now()) { rl.n = 0; rl.reset = Date.now() + 60000; }
  rl.n++; rate.set(ip, rl);
  if (rl.n > config.RATE_LIMIT && url.pathname !== '/api/sync/push') {
    res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
    return res.end(JSON.stringify({ error: "Juda ko'p so'rov. Bir daqiqadan keyin urining" }));
  }
  const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };
  const im = /^\/img\/p\/(\d+)$/.exec(url.pathname);
  if (im) return serveImage(res, im[1]);
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
  try {
    if (url.pathname === '/api/stream') {
      const tk = streamTickets.get(url.searchParams.get('ticket') || '');
      streamTickets.delete(url.searchParams.get('ticket') || '');
      const user = tk && tk.exp > Date.now() && db.prepare('SELECT id,business_id,name,role,active FROM users WHERE id=? AND active=1').get(tk.userId);
      if (!user) fail(401, 'Kirish talab qilinadi');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(': ok\n\n');
      const c = { res, businessId: user.business_id };
      streams.add(c);
      req.on('close', () => streams.delete(c));
      return;
    }
    // Aniq yo'llar (masalan /api/admin/settings) :param li yo'llardan (/api/admin/:entity) oldin tekshiriladi
    const r = routes.find((x) => !x.dynamic && x.method === req.method && x.re.test(url.pathname))
      || routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) fail(404, 'Topilmadi');
    let user = null;
    if (r.roles) {
      user = authUser(req) || fail(401, 'Kirish talab qilinadi');
      if (!r.roles.includes(user.role)) fail(403, "Sizda bu amal uchun huquq yo'q");
      tenant.assertWritable(user, req, url.pathname);
    }
    const body = ['POST', 'PATCH', 'PUT'].includes(req.method) ? await readBody(req, url.pathname === '/api/sync/push' ? 16e6 : 1e6) : {};
    const p = url.pathname.match(r.re).groups || {};
    send(200, await r.handler({ req, url, body, user, p }));
  } catch (e) {
    if (url.pathname === '/api/pay/payme') return send(200, { id: null, error: { code: -32700, message: { uz: "So'rov noto'g'ri", ru: 'Ошибка парсинга', en: 'Parse error' } } });
    if (!(e instanceof HttpError)) console.error(e);
    send(e.status || 500, { error: e instanceof HttpError ? e.message : 'Serverda xatolik' });
  }
});

server.listen(PORT, config.HOST, () => {
  const nets = require('os').networkInterfaces();
  const ips = Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
  console.log(`\n  Dasturxon POS ishga tushdi (${config.MODE === 'cloud' ? 'BULUT rejimi' : 'lokal rejim'})\n  Shu kompyuterda:   http://localhost:${PORT}`);
  if (config.MODE !== 'cloud') ips.forEach((ip) => console.log(`  Planshet/telefon:  http://${ip}:${PORT}`));
  for (const b of db.prepare('SELECT name, code FROM businesses ORDER BY id LIMIT 5').all()) console.log(`  Biznes: ${b.name} — kod ${b.code}`);
  console.log('\n  Namuna PINlar: Admin 1111 | Kassir 2222 | Ofitsiant 3333 | Oshpaz 4444');
  console.log("  Ro'yxatdan o'tish: /#register · Ega kabineti: /#owner · Platforma: /#platform\n");
});
