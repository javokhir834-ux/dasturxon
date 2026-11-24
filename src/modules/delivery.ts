// 6-etap: Yetkazib berish — mijoz ilovasi (/app), to'lov qoidalari, buyurtma holatlari, POS bilan bog'lanish, bulut ↔ lokal kanal.
// Mijoz ilovasi bulut serverda ishlaydi. Biznes bulutdan to'g'ridan-to'g'ri ishlasa — buyurtma shu yerning POSiga tushadi;
// lokal serverli biznes (bulutda "nusxa") bo'lsa — lokal server buyurtmani tortib oladi, holatlarni bulutga qaytaradi.
import crypto from 'node:crypto';
import * as sms from '../services/sms.ts';

import type { Ctx } from '../core/context.ts';
import payments from '../services/payments.ts';
export default function delivery(ctx: Ctx) {
  const { db, route, ROLES, int, str, fail, audit, broadcast, now, needShift, loadOrder, business, sendToKitchen, closeOrder, tenant, sync, office, config, clientIp, imgRef } = ctx;

  // ---------- Sxema ----------
  const addCol = (t, c) => { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* bor */ } };
  ['delivery INTEGER DEFAULT 1', 'non_returnable INTEGER DEFAULT 1', "image TEXT DEFAULT ''"].forEach((c) => addCol('products', c));
  ["type TEXT DEFAULT 'dine'", 'delivery_id INTEGER'].forEach((c) => addCol('orders', c));
  addCol('businesses', "delivery_since TEXT DEFAULT ''");
  db.exec(`
  CREATE TABLE IF NOT EXISTS delivery_settings (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL UNIQUE, enabled INTEGER DEFAULT 0, open INTEGER DEFAULT 1, place_type TEXT DEFAULT 'restoran',
    address TEXT DEFAULT '', description TEXT DEFAULT '', min_order INTEGER DEFAULT 0, delivery_fee INTEGER DEFAULT 10000, prep_minutes INTEGER DEFAULT 30,
    prepay_mode TEXT DEFAULT 'mixed', cash_limit INTEGER DEFAULT 300000, partial_percent INTEGER DEFAULT 0, trusted_after INTEGER DEFAULT 5, expensive_limit INTEGER DEFAULT 500000
  );
  CREATE TABLE IF NOT EXISTS app_users (id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT DEFAULT '', completed INTEGER DEFAULT 0, no_shows INTEGER DEFAULT 0,
    cancels INTEGER DEFAULT 0, blocked INTEGER DEFAULT 0, created_at TEXT);
  CREATE TABLE IF NOT EXISTS app_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS otp_codes (phone TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, attempts INTEGER DEFAULT 0, sent TEXT DEFAULT '[]');
  CREATE TABLE IF NOT EXISTS delivery_orders (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, app_user_id INTEGER, phone TEXT, name TEXT, items TEXT NOT NULL,
    subtotal INTEGER, delivery_fee INTEGER, total INTEGER, prepay_amount INTEGER DEFAULT 0, paid_amount INTEGER DEFAULT 0,
    payment_provider TEXT, payment_status TEXT DEFAULT 'none', status TEXT NOT NULL, address TEXT, lat REAL, lng REAL, note TEXT,
    prep_minutes INTEGER, reject_reason TEXT, commission_percent INTEGER DEFAULT 0, commission INTEGER DEFAULT 0, pos_order_id INTEGER,
    created_at TEXT, updated_at TEXT, accepted_at TEXT, ready_at TEXT, delivered_at TEXT, dirty INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_dlv_biz ON delivery_orders(business_id, updated_at);
  `);
  // 7-etap: kuryer maydonlari
  ['courier_id INTEGER', 'courier_status TEXT', 'offer_courier_id INTEGER', 'offer_expires TEXT', "offer_declined TEXT DEFAULT '[]'", 'handover_code TEXT', 'code_attempts INTEGER DEFAULT 0',
    'assigned_at TEXT', 'picked_at TEXT', 'arrived_at TEXT', 'call_at TEXT', 'courier_fee INTEGER DEFAULT 0', 'courier_rating INTEGER', "rating_comment TEXT DEFAULT ''",
    'own_delivery INTEGER DEFAULT 0', 'pos_pending INTEGER DEFAULT 0', "courier_info TEXT DEFAULT ''", 'search_since TEXT'].forEach((c) => addCol('delivery_orders', c));
  ["delivery_by TEXT DEFAULT 'platform'", 'lat REAL', 'lng REAL'].forEach((c) => addCol('delivery_settings', c));
  // 8-etap: mijoz qarzi (no-show), asossiz shikoyatlar, hisob-kitob akti
  ['debt INTEGER DEFAULT 0', 'false_claims INTEGER DEFAULT 0'].forEach((c) => addCol('app_users', c));
  ['debt_amount INTEGER DEFAULT 0', 'settlement_id INTEGER'].forEach((c) => addCol('delivery_orders', c));
  sync.installTriggers(); // delivery_settings ham bulutga sinxronlanadi

  const DEF = { delivery_by: 'platform', lat: null, lng: null, enabled: 0, open: 1, place_type: 'restoran', address: '', description: '', min_order: 0, delivery_fee: 10000, prep_minutes: 30, prepay_mode: 'mixed', cash_limit: 300000, partial_percent: 0, trusted_after: 5, expensive_limit: 500000 };
  const settingsOf = (b) => ({ ...DEF, ...(db.prepare('SELECT * FROM delivery_settings WHERE business_id=?').get(b) || {}) });
  const isReplica = (b) => !!db.prepare("SELECT 1 FROM businesses WHERE id=? AND sync_key!='' AND sync_url!=''").get(b);
  // 7-etap kuryer moduli ulanadigan joylar
  const ext : Record<string, any> = { courierOf: () => null, publicExtra: () => ({}), cols: [], denied: () => null }; // denied: 8-etap qora ro'yxat
  const getRow = (id) => { const r = db.prepare('SELECT * FROM delivery_orders WHERE id=?').get(id); if (r) r.items = JSON.parse(r.items || '[]'); return r; };
  const PAYABLE = ['trial', 'active', 'grace'];
  const operating = (b) => {
    const s = settingsOf(b);
    return !!s.enabled && !!s.open && PAYABLE.includes(tenant.subStatus(b, 'delivery').status) && PAYABLE.includes(tenant.subStatus(b, 'pos').status);
  };
  const phoneNorm = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.length === 9) d = '998' + d; if (!/^998\d{9}$/.test(d)) fail(400, "Telefon raqam noto'g'ri"); return d; };
  const tokHash = (t) => crypto.createHash('sha256').update(t).digest('hex');

  // ======================= MIJOZ (bulut) =======================
  // SMS kod: key — telefon (mijoz) yoki 'k'+telefon (kuryer)
  async function otpSend(key, phone) {
    const row = db.prepare('SELECT * FROM otp_codes WHERE phone=?').get(key);
    const sent = JSON.parse(row?.sent || '[]').filter((t) => t > Date.now() - 36e5);
    if (sent.some((t) => t > Date.now() - 60000)) fail(429, "Kod yuborildi. 1 daqiqadan keyin qayta so'rang");
    if (sent.length >= 5) fail(429, "Juda ko'p urinish. Keyinroq qayta urining");
    const code = String(crypto.randomInt(10000, 99999));
    db.prepare('INSERT INTO otp_codes (phone,code_hash,expires,attempts,sent) VALUES (?,?,?,0,?) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires=excluded.expires, attempts=0, sent=excluded.sent')
      .run(key, tokHash(key + code), Date.now() + 5 * 60000, JSON.stringify([...sent, Date.now()]));
    const r = await sms.send(phone, `Dasturxon tasdiqlash kodi: ${code}`);
    if (!r.ok) fail(502, 'SMS yuborilmadi: ' + r.reason);
    return { ok: true, ...(sms.MODE === 'test' ? { dev_code: code } : {}) };
  }
  function otpCheck(key, code) {
    const row = db.prepare('SELECT * FROM otp_codes WHERE phone=?').get(key);
    if (!row || row.expires < Date.now()) fail(400, "Kod eskirgan. Yangi kod so'rang");
    if (row.attempts >= 5) fail(429, "Ko'p noto'g'ri urinish. Yangi kod so'rang");
    if (tokHash(key + String(code || '').trim()) !== row.code_hash) { db.prepare('UPDATE otp_codes SET attempts=attempts+1 WHERE phone=?').run(key); fail(400, "Kod noto'g'ri"); }
    db.prepare('DELETE FROM otp_codes WHERE phone=?').run(key);
  }
  const notDenied = (kind, phone) => { if (ext.denied(kind, phone)) fail(403, "Akkaunt bloklangan. Platforma bilan bog'laning"); };
  route('POST', '/api/c/otp', null, async ({ body }) => { const phone = phoneNorm(body.phone); notDenied('customer', phone); return otpSend(phone, phone); });
  route('POST', '/api/c/login', null, ({ body }) => {
    const phone = phoneNorm(body.phone);
    notDenied('customer', phone);
    otpCheck(phone, body.code);
    let u = db.prepare('SELECT * FROM app_users WHERE phone=?').get(phone);
    if (!u) { db.prepare('INSERT INTO app_users (phone,name,created_at) VALUES (?,?,?)').run(phone, str(body.name, 'Ism', { required: false, max: 60 }), now()); u = db.prepare('SELECT * FROM app_users WHERE phone=?').get(phone); }
    else if (body.name && !u.name) db.prepare('UPDATE app_users SET name=? WHERE id=?').run(str(body.name, 'Ism', { max: 60 }), u.id);
    if (u.blocked) fail(403, 'Akkaunt bloklangan');
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO app_sessions (token_hash,user_id,created_at) VALUES (?,?,?)').run(tokHash(token), u.id, now());
    return { token, user: db.prepare('SELECT id,phone,name FROM app_users WHERE id=?').get(u.id) };
  });
  const appUser = (req, required = true) => {
    const h = req.headers.authorization || ''; const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const s = t && db.prepare('SELECT user_id FROM app_sessions WHERE token_hash=?').get(tokHash(t));
    const u = s && db.prepare('SELECT * FROM app_users WHERE id=?').get(s.user_id);
    if (!u && required) fail(401, 'Telefon orqali kiring');
    if (u?.blocked) fail(403, 'Akkaunt bloklangan');
    return u || null;
  };
  route('GET', '/api/c/me', null, ({ req }) => { const u = appUser(req); return { id: u.id, phone: u.phone, name: u.name, completed: u.completed, debt: u.debt }; });
  route('POST', '/api/c/me', null, ({ req, body }) => { const u = appUser(req); db.prepare('UPDATE app_users SET name=? WHERE id=?').run(str(body.name, 'Ism', { max: 60 }), u.id); return { ok: true }; });
  route('POST', '/api/c/logout', null, ({ req }) => { const h = req.headers.authorization || ''; if (h.startsWith('Bearer ')) db.prepare('DELETE FROM app_sessions WHERE token_hash=?').run(tokHash(h.slice(7))); return { ok: true }; });

  const placeView = (b) => { const s = settingsOf(b.id); return { code: b.code, name: b.name, type: s.place_type, address: s.address, description: s.description, min_order: s.min_order, delivery_fee: s.delivery_fee, prep_minutes: s.prep_minutes, open: operating(b.id) }; };
  route('GET', '/api/c/places', null, ({ url }) => {
    const type = url.searchParams.get('type');
    return db.prepare('SELECT b.id, b.name, b.code FROM businesses b JOIN delivery_settings s ON s.business_id=b.id WHERE s.enabled=1 ORDER BY b.name').all()
      .filter((b) => PAYABLE.includes(tenant.subStatus(b.id, 'delivery').status) && tenant.subStatus(b.id, 'pos').status !== 'blocked')
      .map(placeView).filter((p) => !type || p.type === type).sort((a, z) => Number(z.open) - Number(a.open));
  });
  const placeByCode = (code) => {
    const b = db.prepare('SELECT b.id, b.name, b.code FROM businesses b JOIN delivery_settings s ON s.business_id=b.id WHERE b.code=? AND s.enabled=1').get(String(code || ''));
    if (!b || !PAYABLE.includes(tenant.subStatus(b.id, 'delivery').status)) fail(404, 'Joy topilmadi');
    return b;
  };
  route('GET', '/api/c/places/:code', null, ({ p }) => {
    const b = placeByCode(p.code);
    const cats = db.prepare('SELECT id, name, color FROM categories WHERE business_id=? AND active=1 ORDER BY sort, id').all(b.id);
    const prods = db.prepare('SELECT id, category_id, name, price, image, in_stop, non_returnable FROM products WHERE business_id=? AND active=1 AND delivery=1 ORDER BY sort, id').all(b.id);
    return { place: placeView(b), categories: cats.filter((c) => prods.some((x) => x.category_id === c.id)), products: prods.map(imgRef),
      modifiers: db.prepare('SELECT id, name, price FROM modifiers WHERE business_id=? AND active=1').all(b.id) };
  });

  // To'lov qoidasi: kim qancha oldindan to'laydi
  function policy(s, u, total, items) {
    const trusted = !!u && u.completed >= s.trusted_after && u.no_shows === 0;
    const expensive = s.expensive_limit > 0 && total >= s.expensive_limit && items.some((i) => i.non_returnable);
    const overLimit = s.cash_limit > 0 && total > s.cash_limit;
    let type, reason;
    if (u && u.debt > 0) { type = 'full'; reason = `Oldingi olinmagan buyurtma uchun qarz (${u.debt} so'm) shu buyurtmaga qo'shildi — to'liq oldindan to'lov`; }
    else if (s.prepay_mode === 'full') { type = 'full'; reason = "Bu joy faqat oldindan to'lov bilan ishlaydi"; }
    else if (expensive) { type = 'full'; reason = "Qaytarib bo'lmaydigan qimmat buyurtma — to'liq oldindan to'lov"; }
    else if (u && u.no_shows > 0) { type = 'full'; reason = "Avval buyurtmani olmagansiz — to'liq oldindan to'lov"; }
    else if (s.prepay_mode === 'cash') { type = overLimit ? 'full' : 'cash'; reason = overLimit ? "Naqd limitdan oshdi" : 'Naqd mumkin'; }
    else if (!trusted) { type = 'full'; reason = `Yangi mijoz — to'liq oldindan to'lov (${s.trusted_after} ta muvaffaqiyatli buyurtmadan keyin naqd ochiladi)`; }
    else if (overLimit) { type = 'full'; reason = 'Naqd limitdan oshdi'; }
    else if (s.partial_percent > 0) { type = 'partial'; reason = `${s.partial_percent}% oldindan, qolgani naqd`; }
    else { type = 'cash'; reason = 'Ishonchli mijoz — naqd mumkin'; }
    const prepay = type === 'full' ? total : type === 'partial' ? Math.round(total * s.partial_percent / 100) : 0;
    return { type, reason, prepay_amount: prepay, cash_amount: total - prepay };
  }
  function quote(b, u, body) {
    const s = settingsOf(b.id);
    const raw = Array.isArray(body.items) ? body.items : [];
    if (!raw.length) fail(400, "Savat bo'sh");
    if (raw.length > 50) fail(400, "Juda ko'p pozitsiya");
    const items = raw.map((x) => {
      const pr = db.prepare('SELECT * FROM products WHERE id=? AND business_id=? AND active=1 AND delivery=1').get(int(x.product_id, 'Taom', { min: 1 }), b.id) || fail(404, 'Taom topilmadi');
      if (pr.in_stop) fail(409, `"${pr.name}" hozir mavjud emas`);
      const ids = Array.isArray(x.modifier_ids) ? x.modifier_ids.map((m) => int(m, 'Modifikator')) : [];
      const mods = ids.length ? db.prepare(`SELECT id,name,price FROM modifiers WHERE business_id=? AND active=1 AND id IN (${ids.map(() => '?').join(',')})`).all(b.id, ...ids) : [];
      return { product_id: pr.id, name: pr.name, price: pr.price, mod_price: mods.reduce((t, m) => t + m.price, 0), modifiers: mods, qty: int(x.qty ?? 1, 'Soni', { min: 1, max: 50 }),
        comment: str(x.comment, 'Izoh', { required: false, max: 120 }), non_returnable: pr.non_returnable };
    });
    const subtotal = items.reduce((t, i) => t + (i.price + i.mod_price) * i.qty, 0);
    const debt = u?.debt > 0 ? u.debt : 0; // no-show qarzi keyingi buyurtmaga qo'shiladi
    const total = subtotal + s.delivery_fee + debt;
    return { items, subtotal, delivery_fee: s.delivery_fee, debt, total, min_order: s.min_order, min_ok: subtotal >= s.min_order, policy: policy(s, u, total, items), open: operating(b.id) };
  }
  route('POST', '/api/c/quote', null, ({ req, body }) => { const b = placeByCode(body.place); const q = quote(b, appUser(req, false), body); return { ...q, providers: pay.providers() }; });

  route('POST', '/api/c/orders', null, ({ req, body }) => {
    const u = appUser(req);
    const b = placeByCode(body.place);
    if (!operating(b.id)) fail(409, 'Joy hozir buyurtma qabul qilmayapti');
    const q = quote(b, u, body);
    if (!q.min_ok) fail(400, `Minimal buyurtma: ${q.min_order} so'm`);
    let prepay = q.policy.prepay_amount;
    if (body.pay_online) prepay = q.total; // mijoz o'zi to'liq onlayn to'lashni tanlasa
    const provider = prepay > 0 ? (pay.providers().includes(body.provider) ? body.provider : fail(400, "To'lov usulini tanlang")) : 'cash';
    const address = str(body.address, 'Manzil', { max: 300 });
    const lat = body.lat != null && Number.isFinite(Number(body.lat)) ? Number(body.lat) : null, lng = body.lng != null && Number.isFinite(Number(body.lng)) ? Number(body.lng) : null;
    const cp = Number(tenant.setting('commission_percent')) || 0;
    const t = now();
    const id = db.prepare(`INSERT INTO delivery_orders (business_id,app_user_id,phone,name,items,subtotal,delivery_fee,total,prepay_amount,payment_provider,payment_status,status,address,lat,lng,note,commission_percent,commission,created_at,updated_at,debt_amount)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(b.id, u.id, u.phone, u.name || '', JSON.stringify(q.items), q.subtotal, q.delivery_fee, q.total, prepay, provider,
      prepay ? 'pending' : 'none', prepay ? 'awaiting_payment' : 'new', address, lat, lng, str(body.note, 'Izoh', { required: false, max: 300 }), cp, Math.round(q.subtotal * cp / 100), t, t, q.debt).lastInsertRowid;
    const o = getRow(id);
    if (!prepay) notifyNew(o);
    const ret = `${config.MODE === 'cloud' ? '' : ''}/app/#order/${id}`;
    return { order: publicOrder(o), pay_url: prepay ? pay.checkoutUrl(o, provider, ret) : null };
  });
  const publicOrder = (o) => {
    const b = db.prepare('SELECT name, code FROM businesses WHERE id=?').get(o.business_id);
    const { dirty, commission, commission_percent, pos_order_id, settlement_id, offer_courier_id, offer_expires, offer_declined, handover_code, code_attempts, courier_info, pos_pending, ...rest } = o;
    return { ...rest, place: b?.name, place_code: b?.code, ...ext.publicExtra(o) };
  };
  route('GET', '/api/c/orders', null, ({ req }) => {
    const u = appUser(req);
    return db.prepare('SELECT id FROM delivery_orders WHERE app_user_id=? ORDER BY id DESC LIMIT 50').all(u.id).map((r) => publicOrder(getRow(r.id)));
  });
  route('GET', '/api/c/orders/:id', null, ({ req, p }) => {
    const u = appUser(req); const o = getRow(int(p.id, 'id'));
    if (!o || o.app_user_id !== u.id) fail(404, 'Buyurtma topilmadi');
    return publicOrder(o);
  });
  route('POST', '/api/c/orders/:id/cancel', null, ({ req, p }) => {
    const u = appUser(req); const o = getRow(int(p.id, 'id'));
    if (!o || o.app_user_id !== u.id) fail(404, 'Buyurtma topilmadi');
    if (!['awaiting_payment', 'new'].includes(o.status)) fail(409, "Restoran buyurtmani qabul qilgan — bekor qilib bo'lmaydi");
    setStatus(o, 'cancelled', { by: 'customer' });
    return publicOrder(getRow(o.id));
  });
  route('POST', '/api/c/orders/:id/test-pay', null, ({ req, p }) => {
    if (!pay.providers().includes('test')) fail(403, 'Sinov to\'lovi o\'chirilgan');
    const u = appUser(req); const o = getRow(int(p.id, 'id'));
    if (!o || o.app_user_id !== u.id) fail(404, 'Buyurtma topilmadi');
    if (o.status !== 'awaiting_payment') fail(409, "Buyurtma to'lov kutmayapti");
    onPaid(o.id, 'test', o.prepay_amount);
    return publicOrder(getRow(o.id));
  });

  // ======================= HOLATLAR =======================
  const FLOW = {
    awaiting_payment: ['new', 'cancelled'], new: ['accepted', 'rejected', 'cancelled'], accepted: ['ready', 'on_way', 'delivered', 'no_show', 'rejected'],
    ready: ['on_way', 'delivered', 'no_show'], on_way: ['delivered', 'no_show'],
  };
  const STAFF_PUSH = ['admin', 'menejer', 'kassir'];
  function notifyNew(o) {
    broadcast(o.business_id, 'delivery', { new: o.id });
    ctx.push?.toStaff(o.business_id, STAFF_PUSH, { title: '🛵 Yangi buyurtma', body: `D-${o.id} · ${o.total} so'm · ${o.address || ''}`.slice(0, 120), data: { type: 'delivery', id: o.id } });
  }
  // Mijozga holat haqida push (ilova yopiq bo'lsa ham)
  const PUSH_TEXT = { new: 'Buyurtmangiz restoranga yuborildi', accepted: 'Restoran qabul qildi — tayyorlanmoqda', ready: 'Buyurtmangiz tayyor', on_way: "Kuryer yo'lda",
    delivered: 'Yetkazildi. Yoqimli ishtaha!', rejected: 'Restoran buyurtmani rad etdi', cancelled: 'Buyurtma bekor qilindi', no_show: 'Buyurtma olinmadi deb belgilandi' };
  // Holatni o'zgartirish (har ikki serverda). Mijoz hisoblagichlari faqat app_users bor joyda (bulutda) yangilanadi.
  function setStatus(o, to, extra: Record<string, any> = {}) {
    if (!(FLOW[o.status] || []).includes(to)) fail(409, `"${o.status}" holatidan "${to}" ga o'tib bo'lmaydi`);
    const t = now();
    const f : Record<string, any> = { status: to, updated_at: t };
    if (to === 'accepted') { f.accepted_at = t; f.prep_minutes = extra.prep_minutes ?? o.prep_minutes; }
    if (to === 'ready') f.ready_at = t;
    if (to === 'delivered') f.delivered_at = t;
    if (to === 'rejected') f.reject_reason = extra.reason || '';
    if (['rejected', 'cancelled'].includes(to) && o.payment_status === 'paid') f.payment_status = 'refund_due';
    if (to === 'cancelled' && o.payment_status === 'pending') f.payment_status = 'cancelled';
    if (extra.pos_order_id) f.pos_order_id = extra.pos_order_id;
    if (extra.dirty != null) f.dirty = extra.dirty;
    db.prepare(`UPDATE delivery_orders SET ${Object.keys(f).map((k) => k + '=?').join(',')} WHERE id=?`).run(...Object.values(f), o.id);
    if (o.app_user_id) {
      if (to === 'delivered') db.prepare('UPDATE app_users SET completed=completed+1 WHERE id=?').run(o.app_user_id);
      if (to === 'no_show') db.prepare('UPDATE app_users SET no_shows=no_shows+1 WHERE id=?').run(o.app_user_id);
      if (to === 'cancelled' && extra.by === 'customer') db.prepare('UPDATE app_users SET cancels=cancels+1 WHERE id=?').run(o.app_user_id);
    }
    broadcast(o.business_id, 'delivery', { id: o.id });
    if (o.app_user_id && PUSH_TEXT[to]) ctx.push?.toCustomer(o.app_user_id, { title: `Buyurtma #${o.id}`, body: PUSH_TEXT[to], data: { type: 'order', id: o.id } });
    return getRow(o.id);
  }
  function onPaid(id, provider, amount) {
    const o = getRow(id); if (!o || o.payment_status === 'paid') return;
    db.prepare("UPDATE delivery_orders SET payment_status='paid', paid_amount=?, payment_provider=?, updated_at=? WHERE id=?").run(amount, provider, now(), id);
    if (o.debt_amount > 0 && o.app_user_id) { // mijoz qarzini to'ladi → kafolat fondiga qaytadi
      db.prepare('UPDATE app_users SET debt=MAX(0, debt-?) WHERE id=?').run(o.debt_amount, o.app_user_id);
      db.prepare('INSERT INTO fund_moves (amount,order_id,note,at) VALUES (?,?,?,?)').run(o.debt_amount, id, "Mijoz qarzi undirildi (no-show)", now());
    }
    if (o.status === 'awaiting_payment') { setStatus(getRow(id), 'new'); notifyNew(o); }
  }
  function onCancelled(id, refunded) {
    const o = getRow(id); if (!o) return;
    if (refunded) db.prepare("UPDATE delivery_orders SET payment_status='refunded', paid_amount=0, updated_at=? WHERE id=?").run(now(), id);
    else if (o.payment_status === 'pending') db.prepare("UPDATE delivery_orders SET payment_status='cancelled', updated_at=? WHERE id=?").run(now(), id);
    const fresh = getRow(id);
    if (['awaiting_payment', 'new'].includes(fresh.status)) setStatus(fresh, 'cancelled', { by: 'payment' });
  }
  const pay = payments({ db, route, getOrder: getRow, onPaid, onCancelled });
  // To'lanmagan buyurtmalar 30 daqiqadan keyin bekor qilinadi
  setInterval(() => {
    for (const r of db.prepare("SELECT id FROM delivery_orders WHERE status='awaiting_payment' AND created_at < ?").all(new Date(Date.now() - 30 * 60000).toISOString())) {
      try { onCancelled(r.id, false); } catch (e) { console.error(e.message); }
    }
  }, 60000).unref();

  // ======================= POS TOMONI =======================
  const DLV_ROLES = ROLES.CASH;
  const mine = (user, id) => { const o = getRow(int(id, 'id')); if (!o || o.business_id !== user.business_id) fail(404, 'Buyurtma topilmadi'); return o; };
  async function forward(o, to, extra) {
    if (!isReplica(o.business_id)) return;
    const biz = db.prepare('SELECT * FROM businesses WHERE id=?').get(o.business_id);
    try { await sync.cloudCall(biz.sync_url, biz.sync_key, `/api/sync/delivery/${o.id}`, { status: to, ...extra }); db.prepare('UPDATE delivery_orders SET dirty=0 WHERE id=?').run(o.id); }
    catch (e) { db.prepare('UPDATE delivery_orders SET dirty=1 WHERE id=?').run(o.id); console.error('Yetkazib berish holati bulutga yuborilmadi:', e.message); }
  }
  function cancelPosOrder(o, reason, user, writeoff) {
    if (!o.pos_order_id) return;
    const po = db.prepare('SELECT * FROM orders WHERE id=?').get(o.pos_order_id);
    if (!po || po.status !== 'open') return;
    if (writeoff) for (const it of db.prepare("SELECT * FROM order_items WHERE order_id=? AND status IN ('sent','cooking','ready','served')").all(po.id)) office.writeOffCancelled(it, po, reason, user);
    db.prepare("UPDATE order_items SET status='cancelled', cancel_reason=? WHERE order_id=? AND status!='cancelled'").run(reason, po.id);
    db.prepare("UPDATE orders SET status='cancelled', closed_at=?, closed_by=?, cancel_reason=? WHERE id=?").run(now(), user.id, reason, po.id);
    broadcast(o.business_id, 'orders', { id: po.id }); broadcast(o.business_id, 'kitchen');
  }
  async function closePos(o, user) {
    if (!o.pos_order_id) return;
    const po = loadOrder(o.pos_order_id, o.business_id);
    if (po.status !== 'open') return;
    const online = Math.min(o.paid_amount || 0, po.total);
    const method = ['click', 'payme'].includes(o.payment_provider) ? o.payment_provider : 'onlayn';
    const cashM = o.courier_id ? 'kuryer' : 'naqd'; // platforma kuryeri olgan naqd restoran kassasiga tushmaydi
    const list = [...(online ? [{ method, amount: online }] : []), ...(po.total - online > 0 ? [{ method: cashM, amount: po.total - online }] : [])];
    await closeOrder(po, list, user, needShift(o.business_id), 0);
  }
  async function act(user, o, to, extra: Record<string, any> = {}) {
    const b = user.business_id;
    if (o.courier_id && ['on_way', 'delivered', 'no_show'].includes(to)) fail(409, 'Bu buyurtmani platforma kuryeri olib ketadi — holatni kuryer o\'zgartiradi');
    if (['on_way', 'delivered'].includes(to) && !o.own_delivery && settingsOf(b).delivery_by === 'platform' && !o.courier_id) { // kuryer topilmagan — restoran o'zi yetkazadi
      db.prepare('UPDATE delivery_orders SET own_delivery=1, offer_courier_id=NULL, offer_expires=NULL WHERE id=?').run(o.id); o = getRow(o.id); extra = { ...extra, own_delivery: 1 };
    }
    if (to === 'accepted') {
      const shift = needShift(b);
      if (!['new'].includes(o.status)) fail(409, 'Buyurtma qabul qilinadigan holatda emas');
      const prep = int(extra.prep_minutes ?? settingsOf(b).prep_minutes, 'Tayyorlash vaqti', { min: 5, max: 240 });
      const cust = (() => { try { const p = phoneNorm(o.phone); let c = db.prepare('SELECT id FROM customers WHERE business_id=? AND phone=?').get(b, p);
        if (!c) c = { id: db.prepare('INSERT INTO customers (business_id,phone,name,created_at) VALUES (?,?,?,?)').run(b, p, o.name || '', now()).lastInsertRowid }; return c.id; } catch { return null; } })();
      const number = db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM orders WHERE shift_id=?').get(shift.id).n;
      const poId = db.prepare(`INSERT INTO orders (business_id,shift_id,number,table_id,waiter_id,guests,service_percent,created_at,customer_id,type,delivery_id,comment)
        VALUES (?,?,?,NULL,?,1,0,?,?,'delivery',?,?)`).run(b, shift.id, number, user.id, now(), cust, o.id, `🛵 D-${o.id}: ${o.address || ''}`.slice(0, 200)).lastInsertRowid;
      for (const it of o.items) {
        const pr = it.product_id ? db.prepare('SELECT id, workshop_id FROM products WHERE id=? AND business_id=?').get(it.product_id, b) : null;
        db.prepare(`INSERT INTO order_items (business_id,order_id,product_id,workshop_id,name,price,mod_price,modifiers,qty,comment,created_by,created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(b, poId, pr?.id || null, pr?.workshop_id || null, it.name, it.price, it.mod_price || 0, JSON.stringify(it.modifiers || []), it.qty, it.comment || '', user.id, now());
      }
      await sendToKitchen(loadOrder(poId, b), user);
      o = setStatus(o, 'accepted', { prep_minutes: prep, pos_order_id: poId });
      extra = { prep_minutes: prep };
    } else if (to === 'rejected') {
      extra = { reason: str(extra.reason, 'Rad etish sababi', { max: 200 }) };
      cancelPosOrder(o, 'Yetkazib berish rad etildi: ' + extra.reason, user, true);
      o = setStatus(o, 'rejected', extra);
    } else if (to === 'delivered') {
      await closePos(o, user);
      o = setStatus(o, 'delivered');
    } else if (to === 'no_show') {
      if ((o.paid_amount || 0) >= o.subtotal) await closePos(o, user); // oldindan to'langan — restoran pulini oladi
      else cancelPosOrder(o, 'Mijoz buyurtmani olmadi', user, true);
      o = setStatus(o, 'no_show');
    } else o = setStatus(o, to, extra);
    audit(user, 'delivery_' + to, 'delivery_orders', o.id, { total: o.total, ...extra });
    await forward(o, to, extra);
    return getRow(o.id);
  }
  const actRoute = (path, to) => route('POST', `/api/delivery/orders/:id/${path}`, DLV_ROLES, async ({ user, p, body }) => act(user, mine(user, p.id), to, body));
  actRoute('accept', 'accepted'); actRoute('reject', 'rejected'); actRoute('ready', 'ready'); actRoute('dispatch', 'on_way'); actRoute('delivered', 'delivered'); actRoute('no_show', 'no_show');

  route('GET', '/api/delivery/orders', ROLES.FLOOR, ({ user, url }) => {
    const scope = url.searchParams.get('scope') || 'active';
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const rows = scope === 'active'
      ? db.prepare("SELECT id FROM delivery_orders WHERE business_id=? AND status IN ('new','accepted','ready','on_way') ORDER BY id").all(user.business_id)
      : db.prepare("SELECT id FROM delivery_orders WHERE business_id=? AND created_at>=? AND status!='awaiting_payment' ORDER BY id DESC").all(user.business_id, since.toISOString());
    return rows.map((r) => { const o = getRow(r.id); return { ...o, courier: ext.courierOf(o), risk: ext.riskOf ? ext.riskOf(o) : [], handover_code: undefined, offer_declined: undefined }; });
  });
  // Restoran: kuryer topilmasa o'zi yetkazadi
  route('POST', '/api/delivery/orders/:id/own', DLV_ROLES, async ({ user, p }) => {
    const o = mine(user, p.id);
    if (o.courier_id) fail(409, 'Kuryer allaqachon biriktirilgan');
    if (!['new', 'accepted', 'ready'].includes(o.status)) fail(409, "Bu holatda o'zgartirib bo'lmaydi");
    db.prepare('UPDATE delivery_orders SET own_delivery=1, offer_courier_id=NULL, offer_expires=NULL, updated_at=? WHERE id=?').run(now(), o.id);
    audit(user, 'delivery_own', 'delivery_orders', o.id, {});
    await forward(getRow(o.id), o.status, { own_delivery: 1 });
    broadcast(user.business_id, 'delivery', { id: o.id });
    return getRow(o.id);
  });
  // Kuryer yetkazgan, lekin smena yopiq bo'lgani uchun chek yopilmagan buyurtma — kassir qayta yopadi
  route('POST', '/api/delivery/orders/:id/close-pos', DLV_ROLES, async ({ user, p }) => {
    const o = mine(user, p.id);
    if (!o.pos_pending) fail(409, 'Chek yopilgan');
    if (o.status === 'delivered' || (o.paid_amount || 0) >= o.subtotal) await closePos(o, user); else cancelPosOrder(o, 'Mijoz buyurtmani olmadi', user, true);
    db.prepare('UPDATE delivery_orders SET pos_pending=0 WHERE id=?').run(o.id);
    broadcast(user.business_id, 'delivery', { id: o.id });
    return getRow(o.id);
  });
  // Oshxonada hamma taom tayyor bo'lsa — yetkazib berish buyurtmasi "tayyor"
  function onItemReady(orderId, user) {
    const po = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!po?.delivery_id) return;
    const left = db.prepare("SELECT COUNT(*) c FROM order_items WHERE order_id=? AND status IN ('new','sent','cooking')").get(orderId).c;
    const o = getRow(po.delivery_id);
    if (!left && o && o.status === 'accepted') act(user, o, 'ready').catch((e) => console.error('Tayyor holati:', e.message));
  }

  // Sozlamalar
  route('GET', '/api/delivery/settings', ROLES.MANAGE, ({ user }) => ({ ...settingsOf(user.business_id), subscription: tenant.subStatus(user.business_id, 'delivery'), providers: pay.providers() }));
  route('POST', '/api/delivery/settings', ROLES.ADMIN, ({ user, body }) => {
    const b = user.business_id; const cur = settingsOf(b);
    const v : Record<string, any> = {
      enabled: body.enabled != null ? (body.enabled ? 1 : 0) : cur.enabled, open: body.open != null ? (body.open ? 1 : 0) : cur.open,
      place_type: body.place_type != null ? (['restoran', 'fastfood', 'kafe', 'choyxona', 'shirinlik'].includes(body.place_type) ? body.place_type : fail(400, "Turi noto'g'ri")) : cur.place_type,
      address: body.address != null ? str(body.address, 'Manzil', { required: false, max: 200 }) : cur.address,
      description: body.description != null ? str(body.description, 'Tavsif', { required: false, max: 300 }) : cur.description,
      prepay_mode: body.prepay_mode != null ? (['mixed', 'full', 'cash'].includes(body.prepay_mode) ? body.prepay_mode : fail(400, "To'lov rejimi noto'g'ri")) : cur.prepay_mode,
      delivery_by: body.delivery_by != null ? (['platform', 'own'].includes(body.delivery_by) ? body.delivery_by : fail(400, "Kim yetkazishi noto'g'ri")) : cur.delivery_by,
      lat: body.lat !== undefined ? (body.lat === null || body.lat === '' ? null : Number.isFinite(Number(body.lat)) ? Number(body.lat) : fail(400, "Koordinata noto'g'ri")) : cur.lat,
      lng: body.lng !== undefined ? (body.lng === null || body.lng === '' ? null : Number.isFinite(Number(body.lng)) ? Number(body.lng) : fail(400, "Koordinata noto'g'ri")) : cur.lng,
    };
    for (const [k, max] of [['min_order', 1e8], ['delivery_fee', 1e7], ['prep_minutes', 240], ['cash_limit', 1e9], ['partial_percent', 90], ['trusted_after', 100], ['expensive_limit', 1e9]])
      v[k] = body[k] != null ? int(body[k], k as string, { max: max as number }) : cur[k];
    if (v.enabled && !isReplica(b) && !PAYABLE.includes(tenant.subStatus(b, 'delivery').status)) fail(409, "Yetkazib berish obunasi faol emas. Platforma bilan bog'laning");
    const keys = Object.keys(v);
    if (db.prepare('SELECT 1 FROM delivery_settings WHERE business_id=?').get(b)) db.prepare(`UPDATE delivery_settings SET ${keys.map((k) => k + '=?').join(',')} WHERE business_id=?`).run(...keys.map((k) => v[k]), b);
    else db.prepare(`INSERT INTO delivery_settings (business_id,${keys.join(',')}) VALUES (?,${keys.map(() => '?').join(',')})`).run(b, ...keys.map((k) => v[k]));
    audit(user, 'delivery_settings', 'business', b, v);
    return settingsOf(b);
  });
  route('GET', '/api/delivery/report', ROLES.MANAGE, ({ user, url }) => {
    const f = new Date(`${url.searchParams.get('from')}T00:00:00`), t = new Date(`${url.searchParams.get('to')}T23:59:59.999`);
    if (isNaN(+f) || isNaN(+t)) fail(400, "Sana noto'g'ri");
    const rows = db.prepare("SELECT status, COUNT(*) c, SUM(subtotal) food, SUM(commission) com, SUM(paid_amount) paid FROM delivery_orders WHERE business_id=? AND created_at BETWEEN ? AND ? AND status!='awaiting_payment' GROUP BY status").all(user.business_id, f.toISOString(), t.toISOString());
    return { rows };
  });

  // ======================= BULUT ↔ LOKAL =======================
  // Bulut: lokal server yangi/yangilangan buyurtmalarni tortadi (mahsulot ID lari lokal ID ga tarjima qilinadi)
  route('GET', '/api/sync/delivery', null, ({ req, url }) => {
    const biz = sync.bizByKey(req);
    const since = url.searchParams.get('since') || '';
    return db.prepare("SELECT id FROM delivery_orders WHERE business_id=? AND updated_at > ? AND status!='awaiting_payment' ORDER BY updated_at LIMIT 200").all(biz.id, since).map((r) => {
      const o = getRow(r.id);
      o.items = o.items.map((i) => ({ ...i, product_id: db.prepare("SELECT local_id FROM sync_map WHERE business_id=? AND t='products' AND cloud_id=?").get(biz.id, i.product_id)?.local_id ?? null }));
      const c = ext.courierOf(o); o.courier_info = c ? JSON.stringify(c) : '';
      return o;
    });
  });
  // Bulut: lokal serverdan holat o'zgarishi
  route('POST', '/api/sync/delivery/:id', null, ({ req, p, body }) => {
    const biz = sync.bizByKey(req);
    const o = getRow(int(p.id, 'id'));
    if (!o || o.business_id !== biz.id) fail(404, 'Buyurtma topilmadi');
    if (body.own_delivery && !o.courier_id) db.prepare('UPDATE delivery_orders SET own_delivery=1, offer_courier_id=NULL, offer_expires=NULL, updated_at=? WHERE id=?').run(now(), o.id);
    if (o.status === body.status) return { ok: true, status: o.status };
    return { ok: true, status: setStatus(o, body.status, { prep_minutes: body.prep_minutes, reason: body.reason }).status };
  });
  // Lokal: har sinxron davrida — avval yuborilmagan holatlar, keyin yangi buyurtmalarni tortish
  sync.addTickHook(async (biz, call) => {
    for (const o of db.prepare('SELECT * FROM delivery_orders WHERE business_id=? AND dirty=1').all(biz.id)) {
      try { await call(biz.sync_url, biz.sync_key, `/api/sync/delivery/${o.id}`, { status: o.status, prep_minutes: o.prep_minutes, reason: o.reject_reason }); db.prepare('UPDATE delivery_orders SET dirty=0 WHERE id=?').run(o.id); }
      catch (e) {
        if (/o'tib bo'lmaydi/.test(e.message)) { // bulutda mijoz bekor qilgan — lokalda ham bekor qilamiz
          db.prepare("UPDATE delivery_orders SET status='cancelled', dirty=0 WHERE id=?").run(o.id);
          cancelPosOrder(o, 'Mijoz bekor qildi', { id: null }, false);
        } else throw e;
      }
    }
    const rows = await call(biz.sync_url, biz.sync_key, `/api/sync/delivery?since=${encodeURIComponent(biz.delivery_since || '')}`);
    let maxT = biz.delivery_since || '', fresh = false;
    for (const r of rows) {
      const loc = db.prepare('SELECT * FROM delivery_orders WHERE id=?').get(r.id);
      const cols = ['business_id', 'app_user_id', 'phone', 'name', 'items', 'subtotal', 'delivery_fee', 'total', 'prepay_amount', 'paid_amount', 'payment_provider', 'payment_status', 'status',
        'address', 'lat', 'lng', 'note', 'prep_minutes', 'reject_reason', 'commission_percent', 'commission', 'created_at', 'updated_at', 'accepted_at', 'ready_at', 'delivered_at',
        'courier_id', 'courier_status', 'courier_info', 'own_delivery', 'search_since', 'picked_at'];
      const val = (c) => (c === 'business_id' ? biz.id : c === 'items' ? JSON.stringify(r.items) : r[c] ?? null);
      if (!loc) { db.prepare(`INSERT INTO delivery_orders (id,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`).run(r.id, ...cols.map(val)); if (r.status === 'new') { fresh = r.id; ctx.push?.toStaff(biz.id, STAFF_PUSH, { title: '🛵 Yangi buyurtma', body: `D-${r.id} · ${r.total} so'm`, data: { type: 'delivery', id: r.id } }); } }
      else if (!loc.dirty) {
        db.prepare(`UPDATE delivery_orders SET ${cols.filter((c) => c !== 'business_id').map((c) => c + '=?').join(',')} WHERE id=?`).run(...cols.filter((c) => c !== 'business_id').map(val), r.id);
        if (r.status === 'cancelled' && loc.status !== 'cancelled') cancelPosOrder(loc, 'Mijoz bekor qildi', { id: null }, false);
        if (['delivered', 'no_show'].includes(r.status) && loc.status !== r.status) await finish(getRow(r.id), r.status); // kuryer yakunladi → restoranda chek
      }
      if (r.updated_at > maxT) maxT = r.updated_at;
    }
    if (rows.length) { db.prepare('UPDATE businesses SET delivery_since=? WHERE id=?').run(maxT, biz.id); broadcast(biz.id, 'delivery', fresh ? { new: fresh } : {}); }
  });

  // Kuryer (yoki bulutdan kelgan holat) buyurtmani yakunlaganda restoran cheki. Smena yopiq bo'lsa — kassir keyin yopadi (pos_pending).
  const systemUser = (b) => db.prepare("SELECT id, business_id, name, role FROM users WHERE business_id=? AND active=1 ORDER BY role='admin' DESC, id LIMIT 1").get(b);
  async function finish(o, to) {
    const user = systemUser(o.business_id);
    try {
      if (!o.pos_order_id) return;
      if (to === 'delivered' || (o.paid_amount || 0) >= o.subtotal) await closePos(o, user); else cancelPosOrder(o, 'Mijoz buyurtmani olmadi', user, true);
      db.prepare('UPDATE delivery_orders SET pos_pending=0 WHERE id=?').run(o.id);
    } catch (e) { db.prepare('UPDATE delivery_orders SET pos_pending=1 WHERE id=?').run(o.id); console.error('Yetkazilgan buyurtma cheki yopilmadi:', e.message); }
    broadcast(o.business_id, 'delivery', { id: o.id });
  }

  return { onItemReady, settingsOf, ext, getRow, setStatus, finish, isReplica, otpSend, otpCheck, phoneNorm, tokHash, operating };
};
