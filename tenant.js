// 4-etap: Ko'p biznes va obuna — ro'yxatdan o'tish, biznes kodi, ega kabineti (filiallar), tariflar/obuna, platforma (super-admin) paneli.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { DATA_DIR, hashPin } = require('./db');

module.exports = function tenant(ctx) {
  const { db, route, int, str, fail, now, clientIp } = ctx;

  // ---------- Sxema ----------
  const addCol = (t, c) => { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* bor */ } };
  ['code TEXT', 'owner_id INTEGER', "phone TEXT DEFAULT ''", "address TEXT DEFAULT ''"].forEach((c) => addCol('businesses', c));
  db.exec(`
  CREATE TABLE IF NOT EXISTS owners (id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS owner_sessions (token_hash TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS platform_sessions (token_hash TEXT PRIMARY KEY, created_at TEXT);
  CREATE TABLE IF NOT EXISTS platform_settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, product TEXT NOT NULL, paid_until TEXT NOT NULL,
    trial INTEGER DEFAULT 1, blocked INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, UNIQUE(business_id, product)
  );
  CREATE TABLE IF NOT EXISTS subscription_payments (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, product TEXT, months INTEGER, amount INTEGER, method TEXT, note TEXT, at TEXT);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_biz_code ON businesses(code);
  `);

  // Platforma sozlamalari (narxlar so'mda)
  const DEFAULTS = { price_pos: '300000', price_delivery: '200000', trial_days: '14', grace_days: '3', commission_percent: '12',
    courier_min_fee: '8000', offer_seconds: '30', dispatch_radius_km: '7', fund_percent: '1', probation_orders: '20', // 7-etap: kuryer sozlamalari
    dispute_days: '2', appeal_days: '3', dispute_fine: '20000' }; // 8-etap: shikoyat muddati, e'tiroz muddati, kuryer jarimasi
  const setting = (k) => db.prepare('SELECT value FROM platform_settings WHERE key=?').get(k)?.value ?? DEFAULTS[k];
  const setSetting = (k, v) => db.prepare('INSERT INTO platform_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

  // Parol: scrypt + tuz
  const hashPass = (p) => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(String(p), salt, 32).toString('hex'); };
  const checkPass = (p, h) => { const [salt, k] = String(h).split(':'); if (!salt || !k) return false; const a = crypto.scryptSync(String(p), salt, 32); return crypto.timingSafeEqual(a, Buffer.from(k, 'hex')); };
  const tokHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const bearer = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : null; };

  // Platforma paroli: PLATFORM_PASSWORD yoki birinchi ishga tushishda yaratiladi va data/platforma-parol.txt ga yoziladi
  if (process.env.PLATFORM_PASSWORD) setSetting('password_hash', hashPass(process.env.PLATFORM_PASSWORD));
  else if (!db.prepare("SELECT 1 FROM platform_settings WHERE key='password_hash'").get()) {
    const pw = crypto.randomBytes(6).toString('base64url');
    setSetting('password_hash', hashPass(pw));
    fs.writeFileSync(path.join(DATA_DIR, 'platforma-parol.txt'), `Platforma paneli (#platform) paroli: ${pw}\nBu faylni xavfsiz joyga saqlang va o'chiring.\n`);
    console.log(`\n  Platforma paneli paroli yaratildi: data/platforma-parol.txt\n`);
  }

  // Biznes kodi: 6 xonali, takrorlanmas
  const newCode = () => { for (;;) { const c = String(crypto.randomInt(100000, 999999)); if (!db.prepare('SELECT 1 FROM businesses WHERE code=?').get(c)) return c; } };
  for (const b of db.prepare('SELECT id FROM businesses WHERE code IS NULL').all()) db.prepare('UPDATE businesses SET code=? WHERE id=?').run(newCode(), b.id);

  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
  const addMonths = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setMonth(d.getMonth() + n); return ymd(d); };
  const ensureSub = (b, product = 'pos', days = Number(setting('trial_days'))) =>
    db.prepare('INSERT OR IGNORE INTO subscriptions (business_id,product,paid_until,trial,enabled) VALUES (?,?,?,1,?)').run(b, product, addDays(ymd(new Date()), days), product === 'pos' ? 1 : 0);
  // Mavjud bizneslar (1-3 etapdan) uchun: 30 kunlik sinov
  for (const b of db.prepare('SELECT id FROM businesses').all()) { ensureSub(b.id, 'pos', 30); ensureSub(b.id, 'delivery', 30); }

  function subStatus(b, product = 'pos') {
    const s = db.prepare('SELECT * FROM subscriptions WHERE business_id=? AND product=?').get(b, product);
    if (!s) return { status: 'none' };
    const today = ymd(new Date());
    const daysLeft = Math.round((new Date(`${s.paid_until}T12:00:00`) - new Date(`${today}T12:00:00`)) / 864e5);
    const grace = Number(setting('grace_days'));
    const status = s.blocked ? 'blocked' : !s.enabled ? 'disabled' : daysLeft >= 0 ? (s.trial ? 'trial' : 'active') : daysLeft >= -grace ? 'grace' : 'expired';
    return { status, paid_until: s.paid_until, days_left: daysLeft, grace_left: status === 'grace' ? grace + daysLeft : null, trial: !!s.trial };
  }

  // Muddat tugasa yoki bloklansa: faqat ko'rish rejimi. Ish kunini yopish uchun ruxsat etilganlar:
  const WRITE_ALLOW = ['/api/logout', '/api/time/clock', '/api/shift/close'];
  function assertWritable(user, req, pathname) {
    if (req.method === 'GET' || pathname === '/api/logout' || pathname === '/api/stream-ticket') return;
    // 8-etap: nizolar faqat bulutda yashaydi (sinxronlanmaydi) — lokal serverli restoran ularni bulutdagi nusxadan yozadi
    if (db.prepare('SELECT mirror FROM businesses WHERE id=?').get(user.business_id)?.mirror && !pathname.startsWith('/api/delivery/disputes'))
      fail(409, "Bu bulutdagi nusxa — faqat ko'rish uchun. O'zgartirishlar restorandagi lokal serverda qilinadi");
    if (WRITE_ALLOW.includes(pathname)) return;
    const s = subStatus(user.business_id);
    if (s.status === 'expired') fail(402, "Obuna muddati tugagan. Tizim faqat ko'rish rejimida. To'lov qilib, davom eting");
    if (s.status === 'blocked') fail(402, 'Biznes vaqtincha bloklangan. Platforma bilan bog\'laning');
  }
  // Kirishda biznesni aniqlash
  function resolveBusiness(code) {
    if (code) {
      const b = db.prepare('SELECT id, name, code FROM businesses WHERE code=?').get(String(code).trim());
      if (!b) fail(404, "Biznes kodi topilmadi");
      return b;
    }
    const all = db.prepare('SELECT id, name, code FROM businesses').all();
    if (all.length === 1) return all[0];
    fail(400, 'Biznes kodini kiriting');
  }
  function assertLoginAllowed(b) { if (subStatus(b).status === 'blocked') fail(403, "Biznes bloklangan. Platforma bilan bog'laning"); }

  // ---------- Yangi biznes uchun boshlang'ich tuzilma ----------
  function setupBusiness(b, sample) {
    const halls = db.prepare('INSERT INTO halls (business_id,name,sort) VALUES (?,?,1)').run(b, 'Asosiy zal').lastInsertRowid;
    for (let i = 1; i <= 6; i++) db.prepare('INSERT INTO tables (business_id,hall_id,name,seats,sort) VALUES (?,?,?,4,?)').run(b, halls, 'Stol ' + i, i);
    const k = db.prepare('INSERT INTO workshops (business_id,name) VALUES (?,?)').run(b, 'Oshxona').lastInsertRowid;
    const bar = db.prepare('INSERT INTO workshops (business_id,name) VALUES (?,?)').run(b, 'Bar').lastInsertRowid;
    const c1 = db.prepare('INSERT INTO categories (business_id,name,color,sort) VALUES (?,?,?,1)').run(b, 'Taomlar', '#c05621').lastInsertRowid;
    const c2 = db.prepare('INSERT INTO categories (business_id,name,color,sort) VALUES (?,?,?,2)').run(b, 'Ichimliklar', '#2b6cb0').lastInsertRowid;
    ['Piyozsiz', 'Achchiq'].forEach((n) => db.prepare('INSERT INTO modifiers (business_id,name,price) VALUES (?,?,0)').run(b, n));
    if (sample) {
      const p = db.prepare('INSERT INTO products (business_id,category_id,workshop_id,name,price,sort) VALUES (?,?,?,?,?,?)');
      [['Osh', 35000], ["Lag'mon", 32000], ['Shashlik', 18000], ['Somsa', 8000], ['Non', 4000]].forEach(([n, pr], i) => p.run(b, c1, k, n, pr, i));
      [["Ko'k choy", 5000], ['Kola 0.5', 9000], ['Suv', 6000]].forEach(([n, pr], i) => p.run(b, c2, bar, n, pr, i));
    }
  }
  // Filial uchun boshqa filialdan menyu va sozlamalarni ko'chirish
  function copyBusiness(from, to) {
    const map = {};
    const copy = (table, cols, remap = {}) => {
      map[table] = {};
      for (const r of db.prepare(`SELECT * FROM ${table} WHERE business_id=? AND active=1`).all(from)) {
        const vals = cols.map((c) => (remap[c] ? map[remap[c]][r[c]] : r[c]));
        if (vals.some((v) => v === undefined)) continue;
        map[table][r.id] = db.prepare(`INSERT INTO ${table} (business_id,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`).run(to, ...vals).lastInsertRowid;
      }
    };
    copy('halls', ['name', 'sort']);
    copy('tables', ['hall_id', 'name', 'seats', 'sort'], { hall_id: 'halls' });
    copy('workshops', ['name']);
    copy('categories', ['name', 'color', 'sort']);
    copy('products', ['category_id', 'workshop_id', 'name', 'price', 'mxik', 'unit', 'sort'], { category_id: 'categories', workshop_id: 'workshops' });
    copy('modifiers', ['name', 'price']);
    copy('ingredients', ['name', 'unit', 'cost', 'min_qty', 'is_semi']);
    for (const r of db.prepare('SELECT * FROM recipe_items WHERE business_id=?').all(from)) {
      const owner = r.owner_type === 'product' ? map.products[r.owner_id] : map.ingredients[r.owner_id];
      const ing = map.ingredients[r.ingredient_id];
      if (owner && ing) db.prepare('INSERT INTO recipe_items (business_id,owner_type,owner_id,ingredient_id,qty) VALUES (?,?,?,?,?)').run(to, r.owner_type, owner, ing, r.qty);
    }
    const src = db.prepare('SELECT service_percent, receipt_footer, cashback_percent FROM businesses WHERE id=?').get(from);
    db.prepare('UPDATE businesses SET service_percent=?, receipt_footer=?, cashback_percent=? WHERE id=?').run(src.service_percent, src.receipt_footer, src.cashback_percent, to);
  }

  const phoneNorm = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.length === 9) d = '998' + d; if (!/^998\d{9}$/.test(d)) fail(400, "Telefon raqam noto'g'ri"); return d; };
  const pinCheck = (p) => { if (!/^\d{4}$/.test(String(p || ''))) fail(400, "PIN 4 ta raqam bo'lishi kerak"); return String(p); };
  const passCheck = (p) => { if (String(p || '').length < 6) fail(400, "Parol kamida 6 belgidan iborat bo'lishi kerak"); return String(p); };

  function createBusiness({ ownerId, name, phone, adminName, adminPin, sample, copyFrom }) {
    db.exec('BEGIN');
    try {
      const code = newCode();
      const b = db.prepare('INSERT INTO businesses (name,service_percent,code,owner_id,phone) VALUES (?,10,?,?,?)').run(name, code, ownerId, phone || '').lastInsertRowid;
      if (copyFrom) copyBusiness(copyFrom, b); else setupBusiness(b, sample);
      db.prepare("INSERT INTO users (business_id,name,pin_hash,role) VALUES (?,?,?,'admin')").run(b, adminName || 'Admin', hashPin(adminPin));
      ensureSub(b, 'pos'); ensureSub(b, 'delivery');
      db.exec('COMMIT');
      return { id: b, code };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // ---------- Ro'yxatdan o'tish (ochiq) ----------
  const regLimit = new Map();
  route('POST', '/api/register', null, ({ body, req }) => {
    const ip = clientIp(req); const n = (regLimit.get(ip) || []).filter((t) => t > Date.now() - 36e5);
    if (n.length >= 5) fail(429, "Juda ko'p urinish. Keyinroq qayta urining");
    regLimit.set(ip, [...n, Date.now()]);
    const name = str(body.business_name, 'Biznes nomi', { max: 80 });
    const ownerName = str(body.owner_name, 'Ega ismi', { max: 80 });
    const phone = phoneNorm(body.phone);
    const pass = passCheck(body.password);
    const pin = pinCheck(body.admin_pin);
    if (db.prepare('SELECT 1 FROM owners WHERE phone=?').get(phone)) fail(409, "Bu telefon bilan ro'yxatdan o'tilgan. Kabinetga kirib, filial qo'shing");
    const ownerId = db.prepare('INSERT INTO owners (name,phone,pass_hash,created_at) VALUES (?,?,?,?)').run(ownerName, phone, hashPass(pass), now()).lastInsertRowid;
    const biz = createBusiness({ ownerId, name, phone, adminName: ownerName, adminPin: pin, sample: !!body.sample });
    return { code: biz.code, business_id: biz.id, trial_days: Number(setting('trial_days')) };
  });
  route('GET', '/api/business-info', null, ({ url }) => {
    const code = url.searchParams.get('code');
    const all = code ? [] : db.prepare('SELECT id, name, code FROM businesses LIMIT 2').all();
    const b = code ? db.prepare('SELECT id, name, code FROM businesses WHERE code=?').get(String(code)) : all.length === 1 ? all[0] : null;
    if (!b) fail(404, code ? 'Biznes kodi topilmadi' : 'Biznes kodini kiriting');
    return { name: b.name, code: b.code };
  });

  // ---------- Ega kabineti ----------
  const ownerLoginFails = new Map();
  route('POST', '/api/owner/login', null, ({ body, req }) => {
    const ip = clientIp(req); const f = ownerLoginFails.get(ip);
    if (f && f.until > Date.now()) fail(429, "Ko'p noto'g'ri urinish. 1 daqiqadan keyin urining");
    const o = db.prepare('SELECT * FROM owners WHERE phone=?').get(phoneNorm(body.phone));
    if (!o || !checkPass(body.password, o.pass_hash)) {
      const k = (f?.n || 0) + 1; ownerLoginFails.set(ip, { n: k >= 5 ? 0 : k, until: k >= 5 ? Date.now() + 60000 : 0 });
      fail(401, "Telefon yoki parol noto'g'ri");
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO owner_sessions (token_hash,owner_id,created_at) VALUES (?,?,?)').run(tokHash(token), o.id, now());
    return { token, owner: { id: o.id, name: o.name, phone: o.phone } };
  });
  const ownerAuth = (req) => {
    const t = bearer(req); const s = t && db.prepare('SELECT owner_id FROM owner_sessions WHERE token_hash=?').get(tokHash(t));
    if (!s) fail(401, 'Kabinetga kirish talab qilinadi');
    return db.prepare('SELECT id,name,phone FROM owners WHERE id=?').get(s.owner_id);
  };
  const ownBiz = (o, id) => db.prepare('SELECT * FROM businesses WHERE id=? AND owner_id=?').get(int(id, 'Filial', { min: 1 }), o.id) || fail(404, 'Filial topilmadi');
  function bizSummary(b, from, to) {
    const r = db.prepare(`SELECT COUNT(DISTINCT o.id) orders, COALESCE(SUM(p.amount),0) revenue FROM orders o JOIN payments p ON p.order_id=o.id
      WHERE o.business_id=? AND o.status='closed' AND o.closed_at BETWEEN ? AND ?`).get(b, from, to);
    const open = db.prepare("SELECT COUNT(*) c FROM orders WHERE business_id=? AND status='open'").get(b).c;
    const shift = db.prepare("SELECT opened_at FROM shifts WHERE business_id=? AND status='open'").get(b);
    return { orders: r.orders, revenue: r.revenue, avg: r.orders ? Math.round(r.revenue / r.orders) : 0, open_orders: open, shift_open: shift?.opened_at || null };
  }
  route('GET', '/api/owner/me', null, ({ req, url }) => {
    const o = ownerAuth(req);
    const from = url.searchParams.get('from'), to = url.searchParams.get('to');
    const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
    const f = ok(from) ? new Date(`${from}T00:00:00`) : new Date(new Date().setHours(0, 0, 0, 0));
    const t = ok(to) ? new Date(`${to}T23:59:59.999`) : new Date(new Date().setHours(23, 59, 59, 999));
    const branches = db.prepare('SELECT id, name, code, phone, address, mirror, last_sync_at FROM businesses WHERE owner_id=? ORDER BY id').all(o.id).map((b) => ({
      ...b, ...bizSummary(b.id, f.toISOString(), t.toISOString()), pos: subStatus(b.id, 'pos'), delivery: subStatus(b.id, 'delivery'),
    }));
    return { owner: o, branches, prices: { pos: Number(setting('price_pos')), delivery: Number(setting('price_delivery')) } };
  });
  route('POST', '/api/owner/branches', null, ({ req, body }) => {
    const o = ownerAuth(req);
    const copyFrom = body.copy_from ? ownBiz(o, body.copy_from).id : null;
    const biz = createBusiness({ ownerId: o.id, name: str(body.name, 'Filial nomi', { max: 80 }), phone: o.phone, adminName: str(body.admin_name, 'Admin ismi', { required: false, max: 80 }) || 'Admin',
      adminPin: pinCheck(body.admin_pin), sample: !copyFrom && !!body.sample, copyFrom });
    if (body.address) db.prepare('UPDATE businesses SET address=? WHERE id=?').run(str(body.address, 'Manzil', { max: 200 }), biz.id);
    return biz;
  });
  route('POST', '/api/owner/branches/:id/admin-pin', null, ({ req, p, body }) => {
    const o = ownerAuth(req); const b = ownBiz(o, p.id); const pin = pinCheck(body.pin);
    const clash = db.prepare("SELECT id, role FROM users WHERE business_id=? AND pin_hash=?").get(b.id, hashPin(pin));
    const admin = db.prepare("SELECT id FROM users WHERE business_id=? AND role='admin' ORDER BY active DESC, id LIMIT 1").get(b.id);
    if (clash && clash.id !== admin?.id) fail(409, 'Bu PIN boshqa xodimda band');
    if (admin) { db.prepare('UPDATE users SET pin_hash=?, active=1 WHERE id=?').run(hashPin(pin), admin.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(admin.id); }
    else db.prepare("INSERT INTO users (business_id,name,pin_hash,role) VALUES (?,?,?,'admin')").run(b.id, 'Admin', hashPin(pin));
    db.prepare('INSERT INTO audit_log (business_id,user_id,action,entity,entity_id,details,at) VALUES (?,?,?,?,?,?,?)').run(b.id, null, 'owner_admin_pin', 'users', admin?.id || null, JSON.stringify({ owner: o.name }), now());
    return { ok: true };
  });
  route('POST', '/api/owner/branches/:id', null, ({ req, p, body }) => {
    const o = ownerAuth(req); const b = ownBiz(o, p.id);
    db.prepare('UPDATE businesses SET name=?, address=? WHERE id=?').run(body.name != null ? str(body.name, 'Nomi', { max: 80 }) : b.name, body.address != null ? str(body.address, 'Manzil', { required: false, max: 200 }) : b.address, b.id);
    return { ok: true };
  });
  route('POST', '/api/owner/password', null, ({ req, body }) => {
    const o = ownerAuth(req);
    const full = db.prepare('SELECT * FROM owners WHERE id=?').get(o.id);
    if (!checkPass(body.old_password, full.pass_hash)) fail(400, "Eski parol noto'g'ri");
    db.prepare('UPDATE owners SET pass_hash=? WHERE id=?').run(hashPass(passCheck(body.new_password)), o.id);
    db.prepare('DELETE FROM owner_sessions WHERE owner_id=? AND token_hash!=?').run(o.id, tokHash(bearer(req)));
    return { ok: true };
  });
  route('POST', '/api/owner/logout', null, ({ req }) => { const t = bearer(req); if (t) db.prepare('DELETE FROM owner_sessions WHERE token_hash=?').run(tokHash(t)); return { ok: true }; });

  // ---------- Platforma (super-admin) ----------
  const platFails = { n: 0, until: 0 };
  route('POST', '/api/platform/login', null, ({ body }) => {
    if (platFails.until > Date.now()) fail(429, "Ko'p noto'g'ri urinish. 5 daqiqadan keyin urining");
    if (!checkPass(body.password, setting('password_hash'))) {
      if (++platFails.n >= 5) { platFails.n = 0; platFails.until = Date.now() + 5 * 6e4; }
      fail(401, "Parol noto'g'ri");
    }
    platFails.n = 0;
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO platform_sessions (token_hash,created_at) VALUES (?,?)').run(tokHash(token), now());
    return { token };
  });
  const platAuth = (req) => { const t = bearer(req); if (!t || !db.prepare('SELECT 1 FROM platform_sessions WHERE token_hash=?').get(tokHash(t))) fail(401, 'Platformaga kirish talab qilinadi'); };
  route('GET', '/api/platform/businesses', null, ({ req }) => {
    platAuth(req);
    const since = new Date(Date.now() - 30 * 864e5).toISOString(), today = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    return db.prepare(`SELECT b.id, b.name, b.code, b.phone, b.address, o.name owner_name, o.phone owner_phone, b.owner_id,
        (SELECT MIN(at) FROM audit_log a WHERE a.business_id=b.id) first_activity,
        (SELECT MAX(at) FROM audit_log a WHERE a.business_id=b.id) last_activity
      FROM businesses b LEFT JOIN owners o ON o.id=b.owner_id ORDER BY b.id DESC`).all().map((b) => ({
      ...b, pos: subStatus(b.id, 'pos'), delivery: subStatus(b.id, 'delivery'),
      orders_30d: db.prepare("SELECT COUNT(*) c FROM orders WHERE business_id=? AND status='closed' AND closed_at>=?").get(b.id, since).c,
      revenue_today: db.prepare("SELECT COALESCE(SUM(p.amount),0) s FROM payments p JOIN orders o ON o.id=p.order_id WHERE o.business_id=? AND o.closed_at>=?").get(b.id, today).s,
      paid_total: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM subscription_payments WHERE business_id=?').get(b.id).s,
    }));
  });
  route('POST', '/api/platform/businesses/:id/extend', null, ({ req, p, body }) => {
    platAuth(req);
    const b = db.prepare('SELECT id FROM businesses WHERE id=?').get(int(p.id, 'id')) || fail(404, 'Biznes topilmadi');
    const product = ['pos', 'delivery'].includes(body.product) ? body.product : 'pos';
    const months = int(body.months, 'Oylar', { min: 1, max: 36 });
    const amount = int(body.amount ?? Number(setting(`price_${product}`)) * months, 'Summa');
    ensureSub(b.id, product);
    const s = db.prepare('SELECT * FROM subscriptions WHERE business_id=? AND product=?').get(b.id, product);
    const today = ymd(new Date());
    const base = s.paid_until >= today ? s.paid_until : today; // muddat o'tgan bo'lsa — bugundan
    db.prepare('UPDATE subscriptions SET paid_until=?, trial=0, enabled=1 WHERE id=?').run(addMonths(base, months), s.id);
    db.prepare('INSERT INTO subscription_payments (business_id,product,months,amount,method,note,at) VALUES (?,?,?,?,?,?,?)')
      .run(b.id, product, months, amount, str(body.method, 'Usul', { required: false, max: 30 }) || 'naqd', str(body.note, 'Izoh', { required: false }), now());
    return subStatus(b.id, product);
  });
  route('POST', '/api/platform/businesses/:id/subscription', null, ({ req, p, body }) => {
    platAuth(req);
    const b = db.prepare('SELECT id FROM businesses WHERE id=?').get(int(p.id, 'id')) || fail(404, 'Biznes topilmadi');
    const product = ['pos', 'delivery'].includes(body.product) ? body.product : 'pos';
    ensureSub(b.id, product);
    const s = db.prepare('SELECT * FROM subscriptions WHERE business_id=? AND product=?').get(b.id, product);
    const pu = body.paid_until != null ? (/^\d{4}-\d{2}-\d{2}$/.test(body.paid_until) ? body.paid_until : fail(400, "Sana noto'g'ri")) : s.paid_until;
    db.prepare('UPDATE subscriptions SET paid_until=?, blocked=?, enabled=? WHERE id=?').run(pu, body.blocked != null ? (body.blocked ? 1 : 0) : s.blocked, body.enabled != null ? (body.enabled ? 1 : 0) : s.enabled, s.id);
    if (body.blocked) db.prepare('DELETE FROM sessions WHERE business_id=?').run(b.id);
    return subStatus(b.id, product);
  });
  route('GET', '/api/platform/settings', null, ({ req }) => { platAuth(req); return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, Number(setting(k))])); });
  route('POST', '/api/platform/settings', null, ({ req, body }) => {
    platAuth(req);
    for (const k of Object.keys(DEFAULTS)) if (body[k] != null) setSetting(k, int(body[k], k, { min: k === 'offer_seconds' ? 5 : 0, max: k.startsWith('price') || ['courier_min_fee', 'dispute_fine'].includes(k) ? 1e9 : ['commission_percent', 'dispatch_radius_km'].includes(k) ? 50 : k === 'fund_percent' ? 10 : k === 'offer_seconds' ? 300 : 365 }));
    if (body.new_password) setSetting('password_hash', hashPass(passCheck(body.new_password)));
    return { ok: true };
  });
  route('GET', '/api/platform/payments', null, ({ req }) => {
    platAuth(req);
    const list = db.prepare('SELECT p.*, b.name business_name FROM subscription_payments p JOIN businesses b ON b.id=p.business_id ORDER BY p.id DESC LIMIT 300').all();
    const byMonth = {};
    db.prepare('SELECT at, amount FROM subscription_payments').all().forEach((x) => { const k = x.at.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + x.amount; });
    return { list, byMonth: Object.entries(byMonth).sort().map(([month, sum]) => ({ month, sum })) };
  });

  return { platAuth, setting, subStatus, assertWritable, resolveBusiness, assertLoginAllowed, ownerAuth, ownBiz, codeOf: (b) => db.prepare('SELECT code FROM businesses WHERE id=?').get(b)?.code };
};
