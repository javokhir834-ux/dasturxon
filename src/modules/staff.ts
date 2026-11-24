// 3-etap: Xodimlar va mijozlar — rollar migratsiyasi, ish vaqti, maosh, mijozlar bazasi, bonus (keshbek),
// stol/banket bronlari (zaklad bilan), egaga Telegram hisobot, avtomatik zaxira nusxa.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../core/db.ts';

import type { Ctx } from '../core/context.ts';
export default function staff(ctx: Ctx) {
  const { db, route, ROLES, int, str, fail, audit, broadcast, now, currentShift, loadOrder, editableOrder, business, office } = ctx;

  // ---------- Migratsiyalar (2-etap bazasidan yangilanish) ----------
  function rebuildWithoutCheck(table, createSql, cols) {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!row || !/CHECK\s*\(/i.test(row.sql)) return;
    db.exec('BEGIN');
    try {
      db.exec(createSql.replace(`CREATE TABLE ${table} `, `CREATE TABLE ${table}_new `));
      db.exec(`INSERT INTO ${table}_new (${cols}) SELECT ${cols} FROM ${table}`);
      db.exec(`DROP TABLE ${table}`);
      db.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
      db.exec('COMMIT');
      console.log(`  Migratsiya: ${table} jadvali yangilandi`);
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  rebuildWithoutCheck('users', `CREATE TABLE users (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL, pin_hash TEXT NOT NULL, role TEXT NOT NULL,
    active INTEGER DEFAULT 1, pay_type TEXT DEFAULT 'none', rate INTEGER DEFAULT 0, percent INTEGER DEFAULT 0, percent_base TEXT DEFAULT 'sales',
    UNIQUE(business_id, pin_hash))`, 'id,business_id,name,pin_hash,role,active');
  rebuildWithoutCheck('payments', `CREATE TABLE payments (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, order_id INTEGER NOT NULL, shift_id INTEGER NOT NULL,
    method TEXT NOT NULL, amount INTEGER NOT NULL, user_id INTEGER, at TEXT, fiscal_status TEXT, fiscal_ref TEXT)`,
  'id,business_id,order_id,shift_id,method,amount,user_id,at,fiscal_status,fiscal_ref');
  const addCol = (t, c) => { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* bor */ } };
  ['customer_id INTEGER', 'deposit INTEGER DEFAULT 0', 'reservation_id INTEGER'].forEach((c) => addCol('orders', c));
  ["cashback_percent INTEGER DEFAULT 5", "tg_token TEXT DEFAULT ''", "tg_chat TEXT DEFAULT ''", "tg_time TEXT DEFAULT '23:30'", "tg_last TEXT DEFAULT ''"].forEach((c) => addCol('businesses', c));
  db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, phone TEXT NOT NULL, name TEXT DEFAULT '', birthday TEXT DEFAULT '',
    note TEXT DEFAULT '', bonus INTEGER DEFAULT 0, discount_percent INTEGER DEFAULT 0, created_at TEXT, UNIQUE(business_id, phone)
  );
  CREATE TABLE IF NOT EXISTS bonus_moves (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, customer_id INTEGER NOT NULL, amount INTEGER NOT NULL, order_id INTEGER, note TEXT, user_id INTEGER, at TEXT);
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, type TEXT DEFAULT 'stol', table_id INTEGER, customer_id INTEGER,
    name TEXT NOT NULL, phone TEXT DEFAULT '', guests INTEGER DEFAULT 2, start_at TEXT NOT NULL, duration_min INTEGER DEFAULT 120,
    deposit INTEGER DEFAULT 0, deposit_method TEXT DEFAULT 'naqd', deposit_refunded INTEGER DEFAULT 0, per_person INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active', order_id INTEGER, note TEXT DEFAULT '', created_by INTEGER, created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS timesheets (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, user_id INTEGER NOT NULL, start_at TEXT NOT NULL, end_at TEXT, note TEXT);
  CREATE TABLE IF NOT EXISTS payroll_payments (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, type TEXT DEFAULT 'avans', note TEXT, from_cash INTEGER DEFAULT 0, by_user INTEGER, at TEXT);
  CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_res_start ON reservations(business_id, start_at);
  `);

  // ---------- Yordamchilar ----------
  const phone = (v) => {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 9) d = '998' + d;
    if (!/^998\d{9}$/.test(d)) fail(400, "Telefon raqam noto'g'ri (masalan 90 123 45 67)");
    return d;
  };
  const dayRange = (from, to) => {
    const ok = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || '') || fail(400, "Sana noto'g'ri");
    ok(from); ok(to);
    return [new Date(`${from}T00:00:00`), new Date(`${to}T23:59:59.999`)];
  };
  const localTs = (v, name) => { const d = new Date(v); if (isNaN(+d)) fail(400, `${name} noto'g'ri`); return d.toISOString(); };
  const cashMove = (b, type, amount, note, userId) => {
    const sh = currentShift(b) || fail(409, "Kassadan pul harakati uchun smena ochiq bo'lishi kerak");
    db.prepare('INSERT INTO cash_moves (business_id,shift_id,type,amount,note,user_id,at) VALUES (?,?,?,?,?,?,?)').run(b, sh.id, type, amount, note, userId, now());
    broadcast(b, 'shift');
  };
  const findOrCreateCustomer = (b, ph, name) => {
    const p = phone(ph);
    let c = db.prepare('SELECT * FROM customers WHERE business_id=? AND phone=?').get(b, p);
    if (!c) {
      const id = db.prepare('INSERT INTO customers (business_id,phone,name,created_at) VALUES (?,?,?,?)').run(b, p, str(name, 'Ism', { required: false, max: 80 }), now()).lastInsertRowid;
      c = db.prepare('SELECT * FROM customers WHERE id=?').get(id);
      broadcast(b, 'customers');
    } else if (name && !c.name) db.prepare('UPDATE customers SET name=? WHERE id=?').run(str(name, 'Ism', { max: 80 }), c.id);
    return db.prepare('SELECT * FROM customers WHERE id=?').get(c.id);
  };

  // ---------- Bootstrap qo'shimchasi ----------
  function bootstrap(user) {
    const biz = business(user.business_id);
    const open = db.prepare('SELECT * FROM timesheets WHERE user_id=? AND end_at IS NULL').get(user.id);
    return { clock: open ? open.start_at : null, cashback_percent: biz.cashback_percent };
  }

  // ---------- Ish vaqti ----------
  route('POST', '/api/time/clock', ROLES.ALL, ({ user }) => {
    const b = user.business_id;
    const open = db.prepare('SELECT * FROM timesheets WHERE user_id=? AND end_at IS NULL').get(user.id);
    if (open) {
      db.prepare('UPDATE timesheets SET end_at=? WHERE id=?').run(now(), open.id);
      audit(user, 'clock_out', 'timesheets', open.id);
    } else {
      const id = db.prepare('INSERT INTO timesheets (business_id,user_id,start_at) VALUES (?,?,?)').run(b, user.id, now()).lastInsertRowid;
      audit(user, 'clock_in', 'timesheets', id);
    }
    broadcast(b, 'staff');
    return bootstrap(user);
  });
  route('GET', '/api/time', ROLES.MANAGE, ({ user, url }) => {
    const [f, t] = dayRange(url.searchParams.get('from'), url.searchParams.get('to'));
    return db.prepare(`SELECT s.*, u.name user_name, u.role FROM timesheets s JOIN users u ON u.id=s.user_id
      WHERE s.business_id=? AND s.start_at <= ? AND (s.end_at IS NULL OR s.end_at >= ?) ORDER BY s.start_at DESC`).all(user.business_id, t.toISOString(), f.toISOString());
  });
  route('POST', '/api/time', ROLES.MANAGE, ({ user, body }) => {
    const b = user.business_id;
    const start = localTs(body.start_at, 'Boshlanish');
    const end = body.end_at ? localTs(body.end_at, 'Tugash') : null;
    if (end && end <= start) fail(400, "Tugash vaqti boshlanishdan keyin bo'lishi kerak");
    let id = body.id ? int(body.id, 'id', { min: 1 }) : null;
    if (id) {
      const old = db.prepare('SELECT * FROM timesheets WHERE id=? AND business_id=?').get(id, b) || fail(404, 'Topilmadi');
      db.prepare('UPDATE timesheets SET start_at=?, end_at=?, note=? WHERE id=?').run(start, end, str(body.note, 'Izoh', { required: false }), id);
      audit(user, 'time_edit', 'timesheets', id, { from: [old.start_at, old.end_at], to: [start, end] });
    } else {
      const uid = int(body.user_id, 'Xodim', { min: 1 });
      if (!db.prepare('SELECT id FROM users WHERE id=? AND business_id=?').get(uid, b)) fail(404, 'Xodim topilmadi');
      id = db.prepare('INSERT INTO timesheets (business_id,user_id,start_at,end_at,note) VALUES (?,?,?,?,?)').run(b, uid, start, end, str(body.note, 'Izoh', { required: false })).lastInsertRowid;
      audit(user, 'time_add', 'timesheets', id, { user_id: uid, start, end });
    }
    broadcast(b, 'staff');
    return { id };
  });

  // ---------- Maosh ----------
  function payroll(b, from, to) {
    const [f, t] = dayRange(from, to);
    const nowD = new Date();
    const days = Math.round((+t - +f) / 864e5);
    const users = db.prepare('SELECT id,name,role,active,pay_type,rate,percent,percent_base FROM users WHERE business_id=? ORDER BY active DESC, id').all(b);
    const sheets = db.prepare('SELECT * FROM timesheets WHERE business_id=? AND start_at <= ? AND (end_at IS NULL OR end_at >= ?)').all(b, t.toISOString(), f.toISOString());
    const orders = db.prepare(`SELECT o.id, o.waiter_id, o.discount_percent, o.discount_amount, o.service_percent, SUM((i.price+i.mod_price)*i.qty) sub
      FROM orders o JOIN order_items i ON i.order_id=o.id AND i.status!='cancelled'
      WHERE o.business_id=? AND o.status='closed' AND o.closed_at BETWEEN ? AND ? GROUP BY o.id`).all(b, f.toISOString(), t.toISOString());
    const paid = db.prepare('SELECT user_id, SUM(amount) s FROM payroll_payments WHERE business_id=? AND at BETWEEN ? AND ? GROUP BY user_id').all(b, f.toISOString(), t.toISOString());
    return users.map((u: any) => {
      const hours = sheets.filter((s) => s.user_id === u.id).reduce((h, s) => {
        const a = Math.max(+new Date(s.start_at), +f), z = Math.min(+(s.end_at ? new Date(s.end_at) : nowD), +t);
        return h + Math.max(0, z - a) / 36e5;
      }, 0);
      const hoursR = Math.round(hours * 100) / 100; // ekranda ko'rinadigan soat bilan hisob bir xil bo'lishi uchun
      const base = u.pay_type === 'hourly' ? Math.round(hoursR * u.rate) : u.pay_type === 'monthly' ? Math.round(u.rate * days / 30) : 0;
      let percentBase = 0;
      if (u.percent) orders.filter((o) => o.waiter_id === u.id).forEach((o) => {
        const disc = Math.min(o.sub, o.discount_amount + Math.round(o.sub * o.discount_percent / 100));
        percentBase += u.percent_base === 'service' ? Math.round((o.sub - disc) * o.service_percent / 100) : o.sub - disc;
      });
      const percentSum = Math.round(percentBase * u.percent / 100);
      const p = paid.find((x) => x.user_id === u.id)?.s || 0;
      return { ...u, hours: hoursR, days, base, percent_base_sum: percentBase, percent_sum: percentSum, earned: base + percentSum, paid: p, balance: base + percentSum - p };
    }).filter((u) => u.active || u.hours || u.paid);
  }
  route('GET', '/api/payroll', ROLES.MANAGE, ({ user, url }) => payroll(user.business_id, url.searchParams.get('from'), url.searchParams.get('to')));
  route('GET', '/api/payroll/payments', ROLES.MANAGE, ({ user, url }) => {
    const [f, t] = dayRange(url.searchParams.get('from'), url.searchParams.get('to'));
    return db.prepare(`SELECT p.*, u.name user_name, b.name by_name FROM payroll_payments p JOIN users u ON u.id=p.user_id LEFT JOIN users b ON b.id=p.by_user
      WHERE p.business_id=? AND p.at BETWEEN ? AND ? ORDER BY p.id DESC`).all(user.business_id, f.toISOString(), t.toISOString());
  });
  route('POST', '/api/payroll/pay', ROLES.MANAGE, ({ user, body }) => {
    const b = user.business_id;
    const u = db.prepare('SELECT * FROM users WHERE id=? AND business_id=?').get(int(body.user_id, 'Xodim', { min: 1 }), b) || fail(404, 'Xodim topilmadi');
    const amount = int(body.amount, 'Summa', { min: 1 });
    const type = body.type === 'maosh' ? 'maosh' : 'avans';
    const note = str(body.note, 'Izoh', { required: false });
    if (body.from_cash) cashMove(b, 'out', amount, `${type === 'maosh' ? 'Maosh' : 'Avans'}: ${u.name}`, user.id);
    db.prepare('INSERT INTO payroll_payments (business_id,user_id,amount,type,note,from_cash,by_user,at) VALUES (?,?,?,?,?,?,?,?)').run(b, u.id, amount, type, note, body.from_cash ? 1 : 0, user.id, now());
    audit(user, 'payroll_pay', 'users', u.id, { name: u.name, amount, type, from_cash: !!body.from_cash });
    broadcast(b, 'staff');
    return { ok: true };
  });

  // ---------- Mijozlar ----------
  const custStats = `SELECT c.*, COUNT(DISTINCT o.id) visits, COALESCE(SUM(p.amount),0) spent, MAX(o.closed_at) last_visit
    FROM customers c LEFT JOIN orders o ON o.customer_id=c.id AND o.status='closed' LEFT JOIN payments p ON p.order_id=o.id`;
  route('GET', '/api/customers', ROLES.FLOOR, ({ user, url }) => {
    const q = (url.searchParams.get('q') || '').trim();
    const digits = q.replace(/\D/g, '');
    return db.prepare(`${custStats} WHERE c.business_id=? ${q ? 'AND (c.name LIKE ? OR c.phone LIKE ?)' : ''} GROUP BY c.id ORDER BY last_visit DESC NULLS LAST, c.id DESC LIMIT 200`)
      .all(...[user.business_id, ...(q ? [`%${q}%`, `%${digits || q}%`] : [])]);
  });
  route('GET', '/api/customers/:id', ROLES.FLOOR, ({ user, p }) => {
    const c = db.prepare(`${custStats} WHERE c.id=? AND c.business_id=? GROUP BY c.id`).get(int(p.id, 'id'), user.business_id) || fail(404, 'Mijoz topilmadi');
    c.orders = db.prepare(`SELECT o.id, o.number, o.closed_at, o.guests, t.name table_name, (SELECT SUM(amount) FROM payments WHERE order_id=o.id) total
      FROM orders o LEFT JOIN tables t ON t.id=o.table_id WHERE o.customer_id=? AND o.status='closed' ORDER BY o.id DESC LIMIT 50`).all(c.id);
    c.bonus_moves = db.prepare('SELECT * FROM bonus_moves WHERE customer_id=? ORDER BY id DESC LIMIT 50').all(c.id);
    return c;
  });
  route('POST', '/api/customers', ROLES.FLOOR, ({ user, body }) => {
    const b = user.business_id;
    const id = body.id ? int(body.id, 'id', { min: 1 }) : null;
    const old = id ? db.prepare('SELECT * FROM customers WHERE id=? AND business_id=?').get(id, b) || fail(404, 'Topilmadi') : null;
    const ph = body.phone !== undefined ? phone(body.phone) : old?.phone ?? fail(400, 'Telefon kiritilmagan');
    const clash = db.prepare('SELECT id FROM customers WHERE business_id=? AND phone=? AND id!=?').get(b, ph, id || 0);
    if (clash) fail(409, "Bu telefon raqamli mijoz allaqachon bor");
    const bd = body.birthday !== undefined ? String(body.birthday || '') : old?.birthday ?? '';
    if (bd && !/^\d{4}-\d{2}-\d{2}$/.test(bd)) fail(400, "Tug'ilgan sana noto'g'ri");
    let disc = old?.discount_percent ?? 0;
    if (body.discount_percent !== undefined && Number(body.discount_percent) !== disc) {
      if (!ROLES.MANAGE.includes(user.role)) fail(403, "Shaxsiy chegirmani faqat admin yoki menejer belgilaydi");
      disc = int(body.discount_percent, 'Chegirma', { max: 50 });
    }
    const v : Record<string, any> = { phone: ph, name: body.name !== undefined ? str(body.name, 'Ism', { required: false, max: 80 }) : old?.name ?? '', birthday: bd,
      note: body.note !== undefined ? str(body.note, 'Izoh', { required: false }) : old?.note ?? '', discount_percent: disc };
    let rid = id;
    if (old) db.prepare('UPDATE customers SET phone=?,name=?,birthday=?,note=?,discount_percent=? WHERE id=?').run(v.phone, v.name, v.birthday, v.note, v.discount_percent, id);
    else rid = db.prepare('INSERT INTO customers (business_id,phone,name,birthday,note,discount_percent,created_at) VALUES (?,?,?,?,?,?,?)').run(b, v.phone, v.name, v.birthday, v.note, v.discount_percent, now()).lastInsertRowid;
    audit(user, old ? 'update' : 'create', 'customers', rid, v);
    broadcast(b, 'customers');
    return db.prepare('SELECT * FROM customers WHERE id=?').get(rid);
  });
  route('POST', '/api/customers/:id/bonus', ROLES.MANAGE, ({ user, p, body }) => {
    const b = user.business_id;
    const c = db.prepare('SELECT * FROM customers WHERE id=? AND business_id=?').get(int(p.id, 'id'), b) || fail(404, 'Topilmadi');
    const amount = int(body.amount, 'Summa', { min: -1e9 });
    if (!amount) fail(400, 'Summa kiritilmagan');
    if (c.bonus + amount < 0) fail(400, "Bonus manfiy bo'lib qoladi");
    const note = str(body.note, 'Sababi');
    db.prepare('UPDATE customers SET bonus=bonus+? WHERE id=?').run(amount, c.id);
    db.prepare('INSERT INTO bonus_moves (business_id,customer_id,amount,note,user_id,at) VALUES (?,?,?,?,?,?)').run(b, c.id, amount, note, user.id, now());
    audit(user, 'bonus_adjust', 'customers', c.id, { amount, note });
    broadcast(b, 'customers');
    return { ok: true };
  });

  // Buyurtmaga mijoz biriktirish
  route('POST', '/api/orders/:id/customer', ROLES.FLOOR, ({ user, p, body }) => {
    const b = user.business_id;
    const o = editableOrder(int(p.id, 'id'), user, { allowPrecheck: true });
    if (body.remove) {
      db.prepare(`UPDATE orders SET customer_id=NULL ${o.discount_reason === 'Mijoz kartasi' ? ", discount_percent=0, discount_reason=NULL" : ''} WHERE id=?`).run(o.id);
      audit(user, 'customer_detach', 'order', o.id, { number: o.number });
    } else {
      const c = body.customer_id
        ? db.prepare('SELECT * FROM customers WHERE id=? AND business_id=?').get(int(body.customer_id, 'Mijoz', { min: 1 }), b) || fail(404, 'Mijoz topilmadi')
        : findOrCreateCustomer(b, body.phone, body.name);
      db.prepare('UPDATE orders SET customer_id=? WHERE id=?').run(c.id, o.id);
      if (c.discount_percent > o.discount_percent && !o.discount_amount)
        db.prepare("UPDATE orders SET discount_percent=?, discount_reason='Mijoz kartasi', precheck_at=NULL WHERE id=?").run(c.discount_percent, o.id);
      audit(user, 'customer_attach', 'order', o.id, { number: o.number, customer: c.phone, discount: c.discount_percent });
    }
    broadcast(b, 'orders', { id: o.id });
    return loadOrder(o.id, b);
  });

  // To'lovdan keyin: bonus hisoblash, bron yakunlash
  function afterPay(order, user) {
    const b = order.business_id;
    if (order.reservation_id) db.prepare("UPDATE reservations SET status='done' WHERE id=?").run(order.reservation_id);
    if (!order.customer_id) return null;
    const spent = order.payments.filter((x) => x.method === 'bonus').reduce((s, x) => s + x.amount, 0);
    const money = order.payments.filter((x) => x.method !== 'bonus').reduce((s, x) => s + x.amount, 0);
    const earned = Math.round(money * (business(b).cashback_percent || 0) / 100);
    const ins = db.prepare('INSERT INTO bonus_moves (business_id,customer_id,amount,order_id,note,user_id,at) VALUES (?,?,?,?,?,?,?)');
    if (spent) ins.run(b, order.customer_id, -spent, order.id, `#${order.number} uchun sarflandi`, user.id, now());
    if (earned) ins.run(b, order.customer_id, earned, order.id, `#${order.number} keshbek`, user.id, now());
    db.prepare('UPDATE customers SET bonus=bonus-?+? WHERE id=?').run(spent, earned, order.customer_id);
    broadcast(b, 'customers');
    return { spent, earned, balance: db.prepare('SELECT bonus FROM customers WHERE id=?').get(order.customer_id).bonus };
  }

  // ---------- Bronlar ----------
  const resSelect = `SELECT r.*, t.name table_name, u.name created_name FROM reservations r LEFT JOIN tables t ON t.id=r.table_id LEFT JOIN users u ON u.id=r.created_by`;
  route('GET', '/api/reservations', ROLES.FLOOR, ({ user, url }) => {
    const d = url.searchParams.get('date');
    const [f, t] = dayRange(d, d);
    return db.prepare(`${resSelect} WHERE r.business_id=? AND r.start_at BETWEEN ? AND ? ORDER BY r.start_at`).all(user.business_id, f.toISOString(), t.toISOString());
  });
  route('GET', '/api/reservations/upcoming', ROLES.ALL, ({ user }) => {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    return db.prepare(`${resSelect} WHERE r.business_id=? AND r.status='active' AND r.start_at BETWEEN ? AND ? ORDER BY r.start_at`)
      .all(user.business_id, new Date(Date.now() - 2 * 36e5).toISOString(), end.toISOString());
  });
  route('POST', '/api/reservations', ROLES.CASH, ({ user, body }) => {
    const b = user.business_id;
    const id = body.id ? int(body.id, 'id', { min: 1 }) : null;
    const old = id ? db.prepare('SELECT * FROM reservations WHERE id=? AND business_id=?').get(id, b) || fail(404, 'Bron topilmadi') : null;
    if (old && old.status !== 'active') fail(409, "Faqat faol bronni o'zgartirish mumkin");
    const type = body.type === 'banket' ? 'banket' : 'stol';
    const start = localTs(`${str(body.date, 'Sana')}T${str(body.time, 'Vaqt')}`, 'Sana/vaqt');
    const duration = int(body.duration_min ?? 120, 'Davomiyligi', { min: 15, max: 1440 });
    const tableId = body.table_id ? int(body.table_id, 'Stol', { min: 1 }) : null;
    if (tableId && !db.prepare('SELECT id FROM tables WHERE id=? AND business_id=?').get(tableId, b)) fail(404, 'Stol topilmadi');
    if (!tableId && type === 'stol') fail(400, 'Stol tanlanmagan');
    if (tableId) {
      const endIso = new Date(+new Date(start) + duration * 6e4).toISOString();
      const clash = db.prepare(`SELECT name, start_at FROM reservations WHERE business_id=? AND table_id=? AND status='active' AND id!=?
        AND start_at < ? AND datetime(start_at, '+' || duration_min || ' minutes') > datetime(?)`).get(b, tableId, id || 0, endIso, start);
      if (clash) fail(409, `Bu stol shu vaqtga band: ${clash.name}, ${new Date(clash.start_at).toTimeString().slice(0, 5)}`);
    }
    const name = str(body.name, 'Mijoz ismi', { max: 80 });
    const ph = body.phone ? phone(body.phone) : '';
    const customer = ph ? findOrCreateCustomer(b, ph, name) : null;
    const v : Record<string, any> = { type, table_id: tableId, customer_id: customer?.id || null, name, phone: ph, guests: int(body.guests ?? 2, 'Mehmonlar', { min: 1, max: 1000 }),
      start_at: start, duration_min: duration, per_person: int(body.per_person ?? 0, 'Kishi boshiga narx'), note: str(body.note, 'Izoh', { required: false, max: 500 }) };
    let rid = id;
    if (old) {
      db.prepare('UPDATE reservations SET type=?,table_id=?,customer_id=?,name=?,phone=?,guests=?,start_at=?,duration_min=?,per_person=?,note=? WHERE id=?')
        .run(v.type, v.table_id, v.customer_id, v.name, v.phone, v.guests, v.start_at, v.duration_min, v.per_person, v.note, id);
      audit(user, 'reservation_edit', 'reservations', id, v);
    } else {
      const deposit = int(body.deposit ?? 0, 'Zaklad');
      const method = ['naqd', 'karta', 'click', 'payme'].includes(body.deposit_method) ? body.deposit_method : 'naqd';
      if (deposit && method === 'naqd') cashMove(b, 'in', deposit, `Zaklad: ${name}`, user.id);
      rid = db.prepare(`INSERT INTO reservations (business_id,type,table_id,customer_id,name,phone,guests,start_at,duration_min,deposit,deposit_method,per_person,note,created_by,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b, v.type, v.table_id, v.customer_id, v.name, v.phone, v.guests, v.start_at, v.duration_min, deposit, method, v.per_person, v.note, user.id, now()).lastInsertRowid;
      audit(user, 'reservation_create', 'reservations', rid, { ...v, deposit, method });
    }
    broadcast(b, 'reservations');
    return db.prepare(`${resSelect} WHERE r.id=?`).get(rid);
  });
  route('POST', '/api/reservations/:id/status', ROLES.FLOOR, ({ user, p, body }) => {
    const b = user.business_id;
    const r = db.prepare('SELECT * FROM reservations WHERE id=? AND business_id=?').get(int(p.id, 'id'), b) || fail(404, 'Bron topilmadi');
    if (r.status !== 'active') fail(409, 'Bron faol emas');
    const to = body.status;
    let orderId = null;
    if (to === 'arrived') {
      const shift = currentShift(b) || fail(409, 'Smena ochilmagan');
      if (!r.table_id) fail(409, "Bronda stol ko'rsatilmagan. Avval stol tanlang");
      const number = db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM orders WHERE shift_id=?').get(shift.id).n;
      const c = r.customer_id ? db.prepare('SELECT * FROM customers WHERE id=?').get(r.customer_id) : null;
      orderId = db.prepare(`INSERT INTO orders (business_id,shift_id,number,table_id,waiter_id,guests,service_percent,created_at,customer_id,deposit,reservation_id,discount_percent,discount_reason,comment)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b, shift.id, number, r.table_id, user.id, r.guests, business(b).service_percent, now(), r.customer_id, r.deposit_refunded ? 0 : r.deposit, r.id,
        c?.discount_percent || 0, c?.discount_percent ? 'Mijoz kartasi' : null, r.type === 'banket' ? `Banket: ${r.note || ''}`.trim() : (r.note || null)).lastInsertRowid;
      db.prepare("UPDATE reservations SET status='arrived', order_id=? WHERE id=?").run(orderId, r.id);
      broadcast(b, 'orders', { id: orderId });
    } else if (to === 'cancelled' || to === 'noshow') {
      if (to === 'cancelled' && body.refund && r.deposit && !r.deposit_refunded) {
        if (!ROLES.CASH.includes(user.role)) fail(403, 'Zakladni faqat kassir qaytaradi');
        if (r.deposit_method === 'naqd') cashMove(b, 'out', r.deposit, `Zaklad qaytarildi: ${r.name}`, user.id);
        db.prepare('UPDATE reservations SET deposit_refunded=1 WHERE id=?').run(r.id);
      }
      db.prepare('UPDATE reservations SET status=? WHERE id=?').run(to, r.id);
    } else fail(400, "Holat noto'g'ri");
    audit(user, 'reservation_' + to, 'reservations', r.id, { name: r.name, deposit: r.deposit, refund: !!body.refund });
    broadcast(b, 'reservations');
    return { ok: true, order_id: orderId };
  });

  // ---------- Sozlamalar: keshbek va Telegram ----------
  route('GET', '/api/admin/loyalty', ROLES.ADMIN, ({ user }) => {
    const biz = business(user.business_id);
    return { cashback_percent: biz.cashback_percent, tg_chat: biz.tg_chat, tg_time: biz.tg_time, tg_token_set: !!biz.tg_token };
  });
  route('POST', '/api/admin/loyalty', ROLES.ADMIN, ({ user, body }) => {
    const b = user.business_id;
    const biz = business(b);
    const cb = body.cashback_percent != null ? int(body.cashback_percent, 'Keshbek', { max: 50 }) : biz.cashback_percent;
    const tok = body.tg_token === '-' ? '' : body.tg_token ? str(body.tg_token, 'Bot token', { max: 100 }) : biz.tg_token;
    const chat = body.tg_chat != null ? str(body.tg_chat, 'Chat ID', { required: false, max: 40 }) : biz.tg_chat;
    const tm = body.tg_time != null ? (/^\d{2}:\d{2}$/.test(body.tg_time) ? body.tg_time : fail(400, "Vaqt noto'g'ri (masalan 23:30)")) : biz.tg_time;
    db.prepare('UPDATE businesses SET cashback_percent=?, tg_token=?, tg_chat=?, tg_time=? WHERE id=?').run(cb, tok, chat, tm, b);
    audit(user, 'settings', 'business', b, { cashback_percent: cb, telegram: !!tok, tg_time: tm });
    broadcast(b, 'menu');
    return { ok: true };
  });

  // ---------- Telegram ----------
  const TG_API = process.env.TG_API || 'https://api.telegram.org';
  const h = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const m = (n) => (Number(n) || 0).toLocaleString('ru-RU').replace(/ /g, ' ');
  async function tgSend(biz, text) {
    if (!biz.tg_token || !biz.tg_chat) return { ok: false, reason: 'Telegram sozlanmagan' };
    try {
      const r = await fetch(`${TG_API}/bot${biz.tg_token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: biz.tg_chat, text, parse_mode: 'HTML', disable_web_page_preview: true }), signal: AbortSignal.timeout(10000) });
      const j = await r.json().catch(() => ({}));
      return j.ok ? { ok: true } : { ok: false, reason: j.description || `HTTP ${r.status}` };
    } catch (e) { return { ok: false, reason: e.message }; }
  }
  const lowStockText = (b) => {
    const low = office.stockList(b).filter((i) => i.low);
    return low.length ? `\n⚠️ <b>Kam qolgan masalliqlar:</b>\n${low.slice(0, 15).map((i) => `• ${h(i.name)}: ${i.qty} ${i.unit}`).join('\n')}` : '';
  };
  function dailyText(b, date = new Date()) {
    const f = new Date(date); f.setHours(0, 0, 0, 0); const t = new Date(date); t.setHours(23, 59, 59, 999);
    const pays = db.prepare(`SELECT p.method, SUM(p.amount) s FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.business_id=? AND o.status='closed' AND o.closed_at BETWEEN ? AND ? GROUP BY p.method`).all(b, f.toISOString(), t.toISOString());
    const cnt = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(guests),0) g FROM orders WHERE business_id=? AND status='closed' AND closed_at BETWEEN ? AND ?`).get(b, f.toISOString(), t.toISOString());
    const cancelled = db.prepare(`SELECT COALESCE(SUM((price+mod_price)*qty),0) s, COUNT(*) c FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.business_id=? AND i.status='cancelled' AND i.sent_at IS NOT NULL AND i.sent_at BETWEEN ? AND ?`).get(b, f.toISOString(), t.toISOString());
    const top = db.prepare(`SELECT i.name, SUM(i.qty) q FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.business_id=? AND o.status='closed' AND o.closed_at BETWEEN ? AND ? AND i.status!='cancelled' GROUP BY i.name ORDER BY q DESC LIMIT 5`).all(b, f.toISOString(), t.toISOString());
    const total = pays.reduce((s, x) => s + x.s, 0);
    const names = { naqd: 'Naqd', karta: 'Karta', click: 'Click', payme: 'Payme', bonus: 'Bonus', zaklad: 'Zaklad' };
    return `📊 <b>${h(business(b).name)}</b> — kunlik hisobot (${f.toLocaleDateString('ru-RU')})\n\n` +
      `💰 Tushum: <b>${m(total)} so'm</b>\n🧾 Buyurtmalar: ${cnt.c} · Mehmonlar: ${cnt.g}\n📈 O'rtacha chek: ${m(cnt.c ? Math.round(total / cnt.c) : 0)} so'm\n` +
      (pays.length ? `\n${pays.map((x) => `• ${names[x.method] || x.method}: ${m(x.s)}`).join('\n')}\n` : '') +
      (cancelled.c ? `\n❌ Bekor qilingan taomlar: ${cancelled.c} ta, ${m(cancelled.s)} so'm\n` : '') +
      (top.length ? `\n🍽 Eng ko'p sotilgan:\n${top.map((x, i) => `${i + 1}. ${h(x.name)} — ${x.q}`).join('\n')}\n` : '') + lowStockText(b);
  }
  function zText(b, z) {
    const s = z.shift; const diff = s.counted_cash - s.expected_cash;
    return `🔒 <b>${h(business(b).name)}</b> — smena #${s.id} yopildi\n\n💰 Tushum: <b>${m(z.revenue)} so'm</b>\n🧾 Buyurtmalar: ${z.orders} · O'rtacha chek: ${m(z.avg)}\n` +
      `• Naqd: ${m(z.byMethod.naqd)} · Karta: ${m(z.byMethod.karta)}\n• Click: ${m(z.byMethod.click)} · Payme: ${m(z.byMethod.payme)}\n` +
      `\n🏷 Chegirmalar: ${m(z.discounts)}\n❌ Bekor qilinganlar: ${m(z.cancelledSum)}\n💵 Kutilgan naqd: ${m(s.expected_cash)}\n✋ Sanalgan: ${m(s.counted_cash)}\n` +
      `${diff ? (diff < 0 ? '🔴 Kamomad: ' : '🟢 Ortiqcha: ') + m(Math.abs(diff)) : '✅ Kassa farqsiz'}` + lowStockText(b);
  }
  route('POST', '/api/admin/telegram/test', ROLES.ADMIN, async ({ user }) => {
    const r = await tgSend(business(user.business_id), '✅ Telegram ulandi. Bugungi holat:\n\n' + dailyText(user.business_id));
    if (!r.ok) fail(502, `Telegram xatosi: ${r.reason}`);
    return r;
  });
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  setInterval(async () => {
    const d = new Date(); const hm = d.toTimeString().slice(0, 5); const today = ymd(d);
    for (const biz of db.prepare("SELECT * FROM businesses WHERE tg_token!='' AND tg_chat!=''").all()) {
      if (hm >= biz.tg_time && biz.tg_last !== today) {
        db.prepare('UPDATE businesses SET tg_last=? WHERE id=?').run(today, biz.id);
        const r = await tgSend(biz, dailyText(biz.id, d));
        if (!r.ok) console.error('Telegram kunlik hisobot:', r.reason);
      }
    }
  }, 60000).unref();

  // ---------- Avtomatik zaxira nusxa ----------
  const BK = path.join(DATA_DIR, 'backups');
  function backup(tag = '') {
    try {
      fs.mkdirSync(BK, { recursive: true });
      const file = path.join(BK, `db-${ymd(new Date())}${tag ? '-' + tag : ''}.sqlite`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      const files = fs.readdirSync(BK).filter((f) => f.endsWith('.sqlite')).map((f) => ({ f, t: fs.statSync(path.join(BK, f)).mtimeMs })).sort((a, z) => z.t - a.t);
      files.slice(40).forEach((x) => fs.unlinkSync(path.join(BK, x.f)));
      return file;
    } catch (e) { console.error('Zaxira nusxa xatosi:', e.message); return null; }
  }
  const dailyBackup = () => { if (!fs.existsSync(path.join(BK, `db-${ymd(new Date())}.sqlite`))) backup(); };
  dailyBackup();
  setInterval(dailyBackup, 36e5).unref();
  route('POST', '/api/admin/backup', ROLES.ADMIN, ({ user }) => {
    const f = backup('qolda'); if (!f) fail(500, 'Zaxira nusxa olinmadi');
    audit(user, 'backup', 'business', user.business_id, { file: path.basename(f) });
    return { ok: true, file: path.basename(f) };
  });

  async function onShiftClose(b, z) {
    backup(`smena-${z.shift.id}`);
    const r = await tgSend(business(b), zText(b, z));
    if (!r.ok && r.reason !== 'Telegram sozlanmagan') console.error('Telegram Z-hisobot:', r.reason);
  }

  return { bootstrap, afterPay, onShiftClose };
};
