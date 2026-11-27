// 7-etap: Kuryerlar — ro'yxat (hujjat, test, sinov davri), taksi kabi taqsimlash, GPS, plomba rasmi, 4 xonali kod,
// no-show tartibi, naqd limit va kunlik hisob, depozit, reyting, darajalar va bonuslar. Kuryer ilovasi: /courier
import crypto from 'node:crypto';

import type { Ctx } from '../core/context.ts';
export default function courier(ctx: Ctx) {
  const { db, route, int, str, fail, now, tenant, broadcast, dlv } = ctx;
  const { ext, getRow, setStatus, finish, isReplica, otpSend, otpCheck, phoneNorm, tokHash, settingsOf } = dlv;
  const NOSHOW_WAIT = Number(process.env.NOSHOW_WAIT_SEC || 600) * 1000; // mijozni kutish (10 daqiqa)
  const SETTLE_HOURS = 24; // naqdni topshirish muddati

  db.exec(`
  CREATE TABLE IF NOT EXISTS couriers (
    id INTEGER PRIMARY KEY, phone TEXT NOT NULL UNIQUE, name TEXT DEFAULT '', vehicle TEXT DEFAULT '', vehicle_no TEXT DEFAULT '',
    status TEXT DEFAULT 'draft', status_reason TEXT DEFAULT '', myid_verified INTEGER DEFAULT 0, test_score INTEGER, test_at TEXT,
    deposit INTEGER DEFAULT 0, online INTEGER DEFAULT 0, lat REAL, lng REAL, loc_at TEXT,
    rating REAL DEFAULT 5, ratings INTEGER DEFAULT 0, completed INTEGER DEFAULT 0, no_shows INTEGER DEFAULT 0, releases INTEGER DEFAULT 0, declines INTEGER DEFAULT 0,
    created_at TEXT, submitted_at TEXT, approved_at TEXT
  );
  CREATE TABLE IF NOT EXISTS courier_sessions (token_hash TEXT PRIMARY KEY, courier_id INTEGER NOT NULL, created_at TEXT);
  CREATE TABLE IF NOT EXISTS courier_docs (courier_id INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT, PRIMARY KEY (courier_id, kind));
  CREATE TABLE IF NOT EXISTS courier_moves (id INTEGER PRIMARY KEY, courier_id INTEGER NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL, order_id INTEGER, note TEXT DEFAULT '', at TEXT);
  CREATE INDEX IF NOT EXISTS idx_cmoves ON courier_moves(courier_id, at);
  CREATE TABLE IF NOT EXISTS delivery_photos (id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, lat REAL, lng REAL, at TEXT);
  CREATE TABLE IF NOT EXISTS fund_moves (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL, order_id INTEGER, note TEXT DEFAULT '', at TEXT);
  `);

  const VEHICLES = { piyoda: 'Piyoda', velosiped: 'Velosiped', moto: 'Moto/skuter', avto: 'Avtomobil' };
  const DOCS = { passport: 'Pasport (yuz tomoni)', selfie: 'Pasport bilan selfi', license: 'Haydovchilik guvohnomasi', vehicle: 'Transport rasmi' };
  // Darajalar: bajarilgan buyurtma + reyting → bonus va naqd limiti
  const LEVELS = [
    { k: 'yangi', name: 'Yangi', min: 0, rating: 0, bonus: 0, cash: 150000 },
    { k: 'bronza', name: 'Bronza', min: 20, rating: 4.5, bonus: 500, cash: 300000 },
    { k: 'kumush', name: 'Kumush', min: 100, rating: 4.7, bonus: 1000, cash: 500000 },
    { k: 'oltin', name: 'Oltin', min: 300, rating: 4.85, bonus: 1500, cash: 800000 },
  ];
  const RATING_WARN = 4.5, RATING_BLOCK = 4.0;
  // Kirish testi: 8 savol, 7 tasi to'g'ri bo'lsa o'tadi
  const TEST = [
    ['Mijoz 4 xonali kodni aytmasa nima qilasiz?', ["Baribir buyurtmani beraman", "Buyurtmani bermayman, ilovadagi tartib bo'yicha ishlayman", "Buyurtmani restoranga qaytaraman"], 1],
    ['Plomba (yopiq paket) rasmini qachon olasiz?', ["Mijozga berganda", "Restorandan paketni olayotganda", "Rasm shart emas"], 1],
    ['Mijoz eshikni ochmasa nima qilasiz?', ["Darhol ketaman", "Qo'ng'iroq qilaman, eshik rasmini olaman va 10 daqiqa kutaman", "Paketni eshik oldida qoldiraman"], 1],
    ["Mijozdan olgan naqd pulni qachon topshirasiz?", ["Har kuni, 24 soat ichida", "Oy oxirida", "Xohlagan vaqtda"], 0],
    ['Restoranda paket ochiq yoki yirtilgan bo\'lsa?', ["Olaveraman", "Olmayman, restoranga aytaman va yopiq paket so'rayman", "O'zim yopaman"], 1],
    ['Reytingingiz 4.5 dan tushsa nima bo\'ladi?', ["Hech narsa", "Ogohlantirish, 4.0 dan pastda bloklanadi", "Darajam oshadi"], 1],
    ['Buyurtmani restorandan olgandan keyin bekor qila olasizmi?', ["Ha, istalgan payt", "Yo'q, oxirigacha yetkazaman; muammo bo'lsa yordamga yozaman", "Ha, mijoz uzoq bo'lsa"], 1],
    ['Mijoz buyurtmani olmasa (tartib bajarilgan), taom kimda qoladi?', ["Kuryerda, yo'l haqi ham to'lanadi", "Restoranga qaytariladi", "Tashlab yuboriladi"], 0],
  ];
  const S = (k) => Number(tenant.setting(k));

  // ---------- Yordamchilar ----------
  const getC = (id) => db.prepare('SELECT * FROM couriers WHERE id=?').get(id);
  const courierAuth = (req) => {
    const h = req.headers.authorization || ''; const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const s = t && db.prepare('SELECT courier_id FROM courier_sessions WHERE token_hash=?').get(tokHash(t));
    const c = s && getC(s.courier_id);
    if (!c) fail(401, 'Telefon orqali kiring');
    return c;
  };
  const km = (a, b, c, d) => { // haversine, km
    if ([a, b, c, d].some((x) => x == null)) return null;
    const r = (x) => (x * Math.PI) / 180, dLat = r(c - a), dLng = r(d - b);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a)) * Math.cos(r(c)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(h));
  };
  const levelOf = (c) => [...LEVELS].reverse().find((l) => c.completed >= l.min && (c.ratings < 5 || c.rating >= l.rating)) || LEVELS[0];
  const cashLimit = (c) => Math.min(levelOf(c).cash, c.deposit || 0);
  // Hisob: balance > 0 — platforma kuryerga qarzdor; hand — kuryer qo'lidagi naqd; since — topshirilmagan naqd qachondan beri
  function money(cid) {
    const moves = db.prepare('SELECT type, amount, at FROM courier_moves WHERE courier_id=? ORDER BY id').all(cid);
    let balance = 0, hand = 0, since = null, earnedToday = 0;
    const day = new Date(); day.setHours(0, 0, 0, 0); const d0 = day.toISOString();
    for (const m of moves) {
      if (m.type === 'deposit') continue;
      balance += m.amount;
      if (m.type === 'cash') { if (hand <= 0) since = m.at; hand += -m.amount; }
      if (m.type === 'cash_in') { hand -= m.amount; if (hand <= 0) { hand = 0; since = null; } }
      if (['fee', 'bonus'].includes(m.type) && m.at >= d0) earnedToday += m.amount;
    }
    const mustSettle = hand > 0 && since && Date.now() - +new Date(since) > SETTLE_HOURS * 36e5;
    return { balance, hand, since, mustSettle: !!mustSettle, earnedToday };
  }
  const move = (cid, type, amount, order_id = null, note = '') => db.prepare('INSERT INTO courier_moves (courier_id,type,amount,order_id,note,at) VALUES (?,?,?,?,?,?)').run(cid, type, amount, order_id, note, now());
  const ACTIVE = "('accepted','ready','on_way')";
  const activeOrder = (cid) => db.prepare(`SELECT id FROM delivery_orders WHERE courier_id=? AND status IN ${ACTIVE} ORDER BY id LIMIT 1`).get(cid);
  const cashToCollect = (o) => o.total - (o.payment_status === 'paid' ? o.paid_amount || 0 : 0);
  const placeOf = (o) => { const b = db.prepare('SELECT id, name FROM businesses WHERE id=?').get(o.business_id); const s = settingsOf(o.business_id); return { name: b?.name, address: s.address, lat: s.lat, lng: s.lng }; };
  const touch = (id, f) => db.prepare(`UPDATE delivery_orders SET ${[...Object.keys(f).map((k) => k + '=?'), 'updated_at=?'].join(',')} WHERE id=?`).run(...Object.values(f), now(), id);
  const ping = (o) => broadcast(o.business_id, 'delivery', { id: o.id });
  const meView = (c) => {
    const m = money(c.id), lv = levelOf(c);
    const docs = db.prepare('SELECT kind FROM courier_docs WHERE courier_id=?').all(c.id).map((d) => d.kind);
    return { id: c.id, phone: c.phone, name: c.name, vehicle: c.vehicle, vehicle_no: c.vehicle_no, status: c.status, status_reason: c.status_reason, myid_verified: !!c.myid_verified,
      test_score: c.test_score, test_passed: c.test_score >= 7, docs, deposit: c.deposit, online: !!c.online, rating: Math.round(c.rating * 100) / 100, ratings: c.ratings, completed: c.completed,
      level: lv.name, level_bonus: lv.bonus, next_level: LEVELS[LEVELS.indexOf(lv) + 1] || null, cash_limit: cashLimit(c), rating_warn: c.ratings >= 5 && c.rating < RATING_WARN,
      probation_left: c.status === 'probation' ? Math.max(0, S('probation_orders') - c.completed) : 0, lat: c.lat, lng: c.lng, ...m }; // lat/lng — kuryer xaritasi
  };

  // Mijoz va restoran uchun kuryer ma'lumoti
  ext.courierOf = (o) => {
    if (o.courier_id) {
      const c = getC(o.courier_id);
      if (c) return { name: c.name, phone: c.phone, vehicle: VEHICLES[c.vehicle] || c.vehicle, vehicle_no: c.vehicle_no, rating: Math.round(c.rating * 10) / 10,
        lat: c.lat, lng: c.lng, loc_at: c.loc_at, status: o.courier_status };
    }
    if (o.courier_info) { try { return { ...JSON.parse(o.courier_info), status: o.courier_status }; } catch {} }
    if (o.courier_status === 'searching') return { status: 'searching', since: o.search_since };
    return null;
  };
  ext.publicExtra = (o) => ({ courier: ext.courierOf(o), handover_code: o.courier_id && ['accepted', 'ready', 'on_way'].includes(o.status) ? o.handover_code : undefined, can_rate: o.status === 'delivered' && !!o.courier_id && !o.courier_rating });

  // ======================= KURYER: KIRISH VA RO'YXAT =======================
  const notDenied = (phone) => { if (ext.denied('courier', phone)) fail(403, "Hisobingiz bloklangan. Platforma bilan bog'laning"); };
  route('POST', '/api/k/otp', null, async ({ body }) => { const phone = phoneNorm(body.phone); notDenied(phone); return otpSend('k' + phone, phone); });
  route('POST', '/api/k/login', null, ({ body }) => {
    const phone = phoneNorm(body.phone);
    notDenied(phone);
    otpCheck('k' + phone, body.code);
    let c = db.prepare('SELECT * FROM couriers WHERE phone=?').get(phone);
    if (!c) { db.prepare('INSERT INTO couriers (phone, created_at) VALUES (?,?)').run(phone, now()); c = db.prepare('SELECT * FROM couriers WHERE phone=?').get(phone); }
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO courier_sessions (token_hash, courier_id, created_at) VALUES (?,?,?)').run(tokHash(token), c.id, now());
    return { token, me: meView(c) };
  });
  route('POST', '/api/k/logout', null, ({ req }) => {
    const c = courierAuth(req); db.prepare('UPDATE couriers SET online=0 WHERE id=?').run(c.id);
    db.prepare('DELETE FROM courier_sessions WHERE token_hash=?').run(tokHash((req.headers.authorization || '').slice(7))); return { ok: true };
  });
  const editable = (c) => { if (!['draft', 'rejected'].includes(c.status)) fail(409, "Ariza yuborilgan — o'zgartirib bo'lmaydi"); };
  route('POST', '/api/k/profile', null, ({ req, body }) => {
    const c = courierAuth(req); editable(c);
    const vehicle = VEHICLES[body.vehicle] ? body.vehicle : fail(400, 'Transport turini tanlang');
    db.prepare('UPDATE couriers SET name=?, vehicle=?, vehicle_no=? WHERE id=?').run(str(body.name, 'Ism-familiya', { max: 80 }), vehicle,
      ['moto', 'avto'].includes(vehicle) ? str(body.vehicle_no, 'Davlat raqami', { max: 16 }).toUpperCase() : '', c.id);
    return meView(getC(c.id));
  });
  route('POST', '/api/k/docs', null, ({ req, body }) => {
    const c = courierAuth(req); editable(c);
    if (!DOCS[body.kind]) fail(400, "Hujjat turi noto'g'ri");
    const d = String(body.data || '');
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d) || d.length > 700000) fail(400, "Rasm noto'g'ri yoki juda katta");
    db.prepare('INSERT INTO courier_docs (courier_id,kind,data,created_at) VALUES (?,?,?,?) ON CONFLICT(courier_id,kind) DO UPDATE SET data=excluded.data, created_at=excluded.created_at').run(c.id, body.kind, d, now());
    return meView(getC(c.id));
  });
  route('GET', '/api/k/test', null, ({ req }) => { courierAuth(req); return TEST.map(([q, a]) => ({ q, a })); });
  route('POST', '/api/k/test', null, ({ req, body }) => {
    const c = courierAuth(req); editable(c);
    if (c.test_at && Date.now() - +new Date(c.test_at) < 10 * 60000 && c.test_score < 7) fail(429, "Testni 10 daqiqadan keyin qayta topshirish mumkin");
    const ans = Array.isArray(body.answers) ? body.answers : [];
    const score = TEST.reduce((t, [, , right], i) => t + (Number(ans[i]) === right ? 1 : 0), 0);
    db.prepare('UPDATE couriers SET test_score=?, test_at=? WHERE id=?').run(score, now(), c.id);
    return { score, total: TEST.length, passed: score >= 7, wrong: TEST.map(([, , r], i) => (Number(ans[i]) === r ? null : i)).filter((x) => x != null) };
  });
  route('POST', '/api/k/submit', null, ({ req }) => {
    const c = courierAuth(req); editable(c);
    if (!c.name || !c.vehicle) fail(400, "Avval ma'lumotlaringizni to'ldiring");
    const docs = db.prepare('SELECT kind FROM courier_docs WHERE courier_id=?').all(c.id).map((d) => d.kind);
    const need = ['passport', 'selfie', ...(['moto', 'avto'].includes(c.vehicle) ? ['license'] : [])].filter((k) => !docs.includes(k));
    if (need.length) fail(400, 'Hujjat yetishmaydi: ' + need.map((k) => DOCS[k]).join(', '));
    if (!(c.test_score >= 7)) fail(400, "Avval testdan o'ting");
    db.prepare("UPDATE couriers SET status='pending', status_reason='', submitted_at=? WHERE id=?").run(now(), c.id);
    return meView(getC(c.id));
  });

  // ======================= KURYER: ISH =======================
  const working = (c) => { if (!['probation', 'active'].includes(c.status)) fail(403, c.status === 'blocked' ? `Hisobingiz bloklangan: ${c.status_reason}` : 'Arizangiz hali tasdiqlanmagan'); };
  route('POST', '/api/k/location', null, ({ req, body }) => {
    const c = courierAuth(req);
    const lat = Number(body.lat), lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, "Koordinata noto'g'ri");
    db.prepare('UPDATE couriers SET lat=?, lng=?, loc_at=? WHERE id=?').run(lat, lng, now(), c.id);
    const a = activeOrder(c.id); if (a) { const o = getRow(a.id); touch(o.id, {}); ping(o); } // restoran/mijoz kuryer joyini ko'radi
    return { ok: true };
  });
  route('POST', '/api/k/online', null, ({ req, body }) => {
    const c = courierAuth(req); working(c);
    if (body.online && money(c.id).mustSettle) fail(409, `Naqd pul ${SETTLE_HOURS} soatdan beri topshirilmagan. Avval kunlik hisobni topshiring`);
    db.prepare('UPDATE couriers SET online=? WHERE id=?').run(body.online ? 1 : 0, c.id);
    return meView(getC(c.id));
  });
  // Kuryer ilovasi har 3 soniyada so'raydi: holat, taklif, faol buyurtma
  route('GET', '/api/k/state', null, ({ req }) => {
    const c = courierAuth(req);
    const me = meView(c);
    let offer = null, order = null;
    const ofr = db.prepare("SELECT id FROM delivery_orders WHERE offer_courier_id=? AND offer_expires>? AND courier_id IS NULL AND status IN ('accepted','ready') LIMIT 1").get(c.id, now());
    const of = ofr && getRow(ofr.id);
    if (of) {
      const pl = placeOf(of);
      offer = { id: of.id, place: pl.name, place_address: pl.address, to_place_km: km(c.lat, c.lng, pl.lat, pl.lng), trip_km: km(pl.lat, pl.lng, of.lat, of.lng),
        address: of.address, fee: Math.max(of.delivery_fee, S('courier_min_fee')) + levelOf(c).bonus, cash: cashToCollect(of), items: of.items.reduce((t, i) => t + i.qty, 0), expires: of.offer_expires };
    }
    const a = activeOrder(c.id);
    if (a) {
      const o = getRow(a.id), pl = placeOf(o);
      order = { id: o.id, status: o.status, courier_status: o.courier_status, place: pl, customer: { name: o.name, phone: o.phone, address: o.address, lat: o.lat, lng: o.lng, note: o.note },
        items: o.items.map((i) => ({ name: i.name, qty: i.qty })), total: o.total, cash: cashToCollect(o), fee: o.courier_fee, prep_minutes: o.prep_minutes, accepted_at: o.accepted_at,
        arrived_at: o.arrived_at, call_at: o.call_at, door_photo: !!db.prepare("SELECT 1 FROM delivery_photos WHERE order_id=? AND kind='door'").get(o.id),
        noshow_at: o.arrived_at ? new Date(new Date(o.arrived_at).getTime() + NOSHOW_WAIT).toISOString() : null };
    }
    return { me, offer, order, server_time: now() };
  });
  const offerFor = (c, id) => {
    const o = getRow(int(id, 'id'));
    if (!o || o.offer_courier_id !== c.id || o.courier_id) fail(409, 'Taklif endi mavjud emas');
    return o;
  };
  route('POST', '/api/k/offers/:id/accept', null, ({ req, p }) => {
    const c = courierAuth(req); working(c);
    const o = offerFor(c, p.id);
    if (o.offer_expires < now()) fail(409, 'Taklif vaqti tugadi');
    if (activeOrder(c.id)) fail(409, 'Sizda faol buyurtma bor');
    const code = String(crypto.randomInt(1000, 10000));
    touch(o.id, { courier_id: c.id, courier_status: 'assigned', offer_courier_id: null, offer_expires: null, assigned_at: now(), handover_code: code, code_attempts: 0,
      courier_fee: Math.max(o.delivery_fee, S('courier_min_fee')) });
    ping(o);
    return { ok: true, id: o.id };
  });
  route('POST', '/api/k/offers/:id/decline', null, ({ req, p }) => {
    const c = courierAuth(req); const o = offerFor(c, p.id);
    declineOffer(o, c.id);
    db.prepare('UPDATE couriers SET declines=declines+1 WHERE id=?').run(c.id);
    return { ok: true };
  });
  function declineOffer(o, cid) {
    const dec = JSON.parse(o.offer_declined || '[]'); if (!dec.includes(cid)) dec.push(cid);
    touch(o.id, { offer_courier_id: null, offer_expires: null, offer_declined: JSON.stringify(dec) });
  }
  const myOrder = (c, id) => {
    const o = getRow(int(id, 'id'));
    if (!o || o.courier_id !== c.id) fail(404, 'Buyurtma topilmadi');
    if (!['accepted', 'ready', 'on_way'].includes(o.status)) fail(409, 'Buyurtma yakunlangan');
    return o;
  };
  const photoOf = (v) => { const d = String(v || ''); if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d) || d.length > 700000) fail(400, 'Rasm kerak'); return d; };
  const savePhoto = (o, kind, data, c) => db.prepare('INSERT INTO delivery_photos (order_id,kind,data,lat,lng,at) VALUES (?,?,?,?,?,?)').run(o.id, kind, data, c.lat, c.lng, now());
  route('POST', '/api/k/orders/:id/arrived_rest', null, ({ req, p }) => {
    const c = courierAuth(req); const o = myOrder(c, p.id);
    if (o.courier_status !== 'assigned') fail(409, "Bu bosqich o'tgan");
    touch(o.id, { courier_status: 'at_restaurant' }); ping(o); return { ok: true };
  });
  // Restorandan olish: plomba (yopiq paket) rasmi majburiy
  route('POST', '/api/k/orders/:id/pickup', null, ({ req, p, body }) => {
    const c = courierAuth(req); const o = myOrder(c, p.id);
    if (!['assigned', 'at_restaurant'].includes(o.courier_status)) fail(409, "Bu bosqich o'tgan");
    if (o.status !== 'ready') fail(409, "Restoran hali buyurtmani tayyor deb belgilamagan. Restoranga ayting");
    savePhoto(o, 'seal', photoOf(body.photo), c);
    setStatus(o, 'on_way');
    touch(o.id, { courier_status: 'picked', picked_at: now() }); ping(o);
    return { ok: true };
  });
  route('POST', '/api/k/orders/:id/arrived', null, ({ req, p }) => {
    const c = courierAuth(req); const o = myOrder(c, p.id);
    if (o.courier_status !== 'picked') fail(409, "Avval buyurtmani restorandan oling");
    touch(o.id, { courier_status: 'at_customer', arrived_at: now() }); ping(o); return { ok: true };
  });
  route('POST', '/api/k/orders/:id/call', null, ({ req, p }) => {
    const c = courierAuth(req); const o = myOrder(c, p.id);
    touch(o.id, { call_at: now() }); return { ok: true };
  });
  route('POST', '/api/k/orders/:id/door', null, ({ req, p, body }) => {
    const c = courierAuth(req); const o = myOrder(c, p.id);
    if (o.courier_status !== 'at_customer') fail(409, 'Avval "Yetib keldim" ni bosing');
    savePhoto(o, 'door', photoOf(body.photo), c); return { ok: true };
  });
  // Topshirish: mijozdagi 4 xonali kod
  route('POST', '/api/k/orders/:id/deliver', null, async ({ req, p, body }) => {
    const c = courierAuth(req); let o = myOrder(c, p.id);
    if (!['picked', 'at_customer'].includes(o.courier_status)) fail(409, "Avval buyurtmani restorandan oling");
    if (o.code_attempts >= 5) fail(429, "Kod 5 marta noto'g'ri kiritildi. Yordam xizmatiga murojaat qiling");
    if (String(body.code || '').trim() !== o.handover_code) { touch(o.id, { code_attempts: o.code_attempts + 1 }); fail(400, "Kod noto'g'ri. Mijozdan ilovadagi kodni so'rang"); }
    const cash = cashToCollect(o);
    o = setStatus(o, 'delivered');
    touch(o.id, { courier_status: 'delivered' });
    const lv = levelOf(c);
    move(c.id, 'fee', o.courier_fee, o.id, 'Yetkazish haqi');
    if (lv.bonus) move(c.id, 'bonus', lv.bonus, o.id, `${lv.name} daraja bonusi`);
    if (cash > 0) move(c.id, 'cash', -cash, o.id, 'Mijozdan naqd olindi');
    const fp = S('fund_percent'); if (fp > 0) db.prepare('INSERT INTO fund_moves (amount,order_id,note,at) VALUES (?,?,?,?)').run(Math.round(o.subtotal * fp / 100), o.id, 'Komissiyadan kafolat fondiga', now());
    db.prepare('UPDATE couriers SET completed=completed+1 WHERE id=?').run(c.id);
    promote(c.id);
    if (!isReplica(o.business_id)) await finish(getRow(o.id), 'delivered');
    ping(o);
    return { ok: true, cash, fee: o.courier_fee + lv.bonus };
  });
  // Mijoz chiqmadi: qo'ng'iroq + eshik rasmi + 10 daqiqa + GPS (mijoz koordinatasi bo'lsa 300 m ichida)
  route('POST', '/api/k/orders/:id/noshow', null, async ({ req, p }) => {
    const c = courierAuth(req); let o = myOrder(c, p.id);
    if (o.courier_status !== 'at_customer' || !o.arrived_at) fail(409, 'Avval "Yetib keldim" ni bosing');
    if (!o.call_at) fail(409, "Avval mijozga qo'ng'iroq qiling");
    if (!db.prepare("SELECT 1 FROM delivery_photos WHERE order_id=? AND kind='door'").get(o.id)) fail(409, 'Eshik/manzil rasmini oling');
    const left = new Date(o.arrived_at).getTime() + NOSHOW_WAIT - Date.now();
    if (left > 0) fail(409, `Yana ${Math.ceil(left / 60000)} daqiqa kuting`);
    const d = km(c.lat, c.lng, o.lat, o.lng);
    if (d != null && d > 0.3) fail(409, `Siz mijoz manzilidan ${Math.round(d * 1000)} m uzoqdasiz`);
    o = setStatus(o, 'no_show');
    touch(o.id, { courier_status: 'no_show' });
    move(c.id, 'fee', o.courier_fee, o.id, "Mijoz olmadi — yo'l haqi");
    const prepaidFee = Math.max(0, (o.payment_status === 'paid' ? o.paid_amount : 0) - o.subtotal);
    if (prepaidFee < o.courier_fee) {
      db.prepare('INSERT INTO fund_moves (amount,order_id,note,at) VALUES (?,?,?,?)').run(-(o.courier_fee - prepaidFee), o.id, "Mijoz olmadi — kuryer haqi fonddan", now());
      if (o.app_user_id) db.prepare('UPDATE app_users SET debt=debt+? WHERE id=?').run(o.courier_fee - prepaidFee, o.app_user_id); // 8-etap: keyingi buyurtmada undiriladi
    }
    db.prepare('UPDATE couriers SET no_shows=no_shows+1 WHERE id=?').run(c.id);
    if (!isReplica(o.business_id)) await finish(getRow(o.id), 'no_show');
    ping(o);
    return { ok: true, fee: o.courier_fee };
  });
  // Olishdan oldin voz kechish (hisoblanadi)
  route('POST', '/api/k/orders/:id/release', null, ({ req, p, body }) => {
    const c = courierAuth(req); const o = myOrder(c, p.id);
    if (!['assigned', 'at_restaurant'].includes(o.courier_status)) fail(409, "Buyurtmani olgansiz — oxirigacha yetkazing yoki yordamga yozing");
    const dec = JSON.parse(o.offer_declined || '[]'); dec.push(c.id);
    touch(o.id, { courier_id: null, courier_status: 'searching', handover_code: null, offer_declined: JSON.stringify(dec), search_since: now() });
    db.prepare('UPDATE couriers SET releases=releases+1 WHERE id=?').run(c.id);
    move(c.id, 'note', 0, o.id, 'Voz kechdi: ' + str(body.reason, 'Sabab', { required: false, max: 120 }));
    ping(o); return { ok: true };
  });
  route('GET', '/api/k/history', null, ({ req }) => {
    const c = courierAuth(req);
    const orders = db.prepare("SELECT id, business_id, status, total, courier_fee, address, delivered_at, updated_at, courier_rating FROM delivery_orders WHERE courier_id=? AND status IN ('delivered','no_show') ORDER BY id DESC LIMIT 50").all(c.id)
      .map((o) => ({ ...o, place: placeOf(o).name }));
    return { orders, moves: db.prepare('SELECT * FROM courier_moves WHERE courier_id=? ORDER BY id DESC LIMIT 100').all(c.id) };
  });

  // Sinov davri → faol; reyting tushsa ogohlantirish/blok
  function promote(cid) {
    const c = getC(cid);
    if (c.status === 'probation' && c.completed >= S('probation_orders') && (c.ratings < 5 || c.rating >= RATING_WARN))
      db.prepare("UPDATE couriers SET status='active', status_reason='' WHERE id=?").run(cid);
  }
  function rerate(cid) {
    const rows = db.prepare('SELECT courier_rating r FROM delivery_orders WHERE courier_id=? AND courier_rating IS NOT NULL ORDER BY id DESC LIMIT 50').all(cid);
    const avg = rows.length ? rows.reduce((t, x) => t + x.r, 0) / rows.length : 5;
    db.prepare('UPDATE couriers SET rating=?, ratings=? WHERE id=?').run(avg, rows.length, cid);
    if (rows.length >= 10 && avg < RATING_BLOCK) db.prepare("UPDATE couriers SET status='blocked', online=0, status_reason=? WHERE id=? AND status IN ('probation','active')").run(`Reyting ${avg.toFixed(2)} — ${RATING_BLOCK} dan past`, cid);
  }
  // Mijoz kuryerni baholaydi
  route('POST', '/api/c/orders/:id/rate', null, ({ req, p, body }) => {
    const h = req.headers.authorization || ''; const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const s = t && db.prepare('SELECT user_id FROM app_sessions WHERE token_hash=?').get(tokHash(t)); if (!s) fail(401, 'Telefon orqali kiring');
    const o = getRow(int(p.id, 'id'));
    if (!o || o.app_user_id !== s.user_id) fail(404, 'Buyurtma topilmadi');
    if (o.status !== 'delivered' || !o.courier_id) fail(409, 'Baholab bo\'lmaydi');
    if (o.courier_rating) fail(409, 'Allaqachon baholangan');
    db.prepare('UPDATE delivery_orders SET courier_rating=?, rating_comment=? WHERE id=?').run(int(body.stars, 'Baho', { min: 1, max: 5 }), str(body.comment, 'Izoh', { required: false, max: 300 }), o.id);
    rerate(o.courier_id); promote(o.courier_id);
    return { ok: true };
  });

  // ======================= TAQSIMLASH (taksi kabi) =======================
  function dispatchTick() {
    const t = now();
    // muddati o'tgan takliflar — rad etilgan hisoblanadi
    for (const o of db.prepare('SELECT * FROM delivery_orders WHERE offer_courier_id IS NOT NULL AND offer_expires<=?').all(t)) declineOffer(o, o.offer_courier_id);
    const need = db.prepare(`SELECT id FROM delivery_orders WHERE status IN ('accepted','ready') AND courier_id IS NULL AND offer_courier_id IS NULL AND own_delivery=0 ORDER BY id`).all();
    if (!need.length) return;
    const fresh = new Date(Date.now() - 3 * 60000).toISOString();
    const cands = db.prepare("SELECT * FROM couriers WHERE online=1 AND status IN ('probation','active') AND loc_at>?").all(fresh)
      .filter((c) => !activeOrder(c.id) && !db.prepare('SELECT 1 FROM delivery_orders WHERE offer_courier_id=?').get(c.id));
    const radius = S('dispatch_radius_km');
    for (const r of need) {
      const o = getRow(r.id);
      if (isReplica(o.business_id)) continue; // lokal serverda taqsimlanmaydi — bulut qiladi
      const st = settingsOf(o.business_id);
      if (st.delivery_by !== 'platform') continue;
      if (o.courier_status !== 'searching') touch(o.id, { courier_status: 'searching', search_since: o.search_since || t });
      const dec = JSON.parse(o.offer_declined || '[]'), cash = cashToCollect(o);
      const pick = cands.filter((c) => !dec.includes(c.id))
        .map((c) => ({ c, d: km(c.lat, c.lng, st.lat, st.lng), m: money(c.id) }))
        .filter(({ c, d, m }) => (d == null || d <= radius) && !m.mustSettle && (cash === 0 || m.hand + cash <= cashLimit(c)))
        .sort((a, b) => ((a.d ?? 99) - LEVELS.indexOf(levelOf(a.c)) * 0.3) - ((b.d ?? 99) - LEVELS.indexOf(levelOf(b.c)) * 0.3))[0];
      if (!pick) { if (dec.length && !cands.some((c) => !dec.includes(c.id))) touch(o.id, { offer_declined: '[]' }); continue; } // hamma rad etgan bo'lsa — qaytadan aylanadi
      touch(o.id, { offer_courier_id: pick.c.id, offer_expires: new Date(Date.now() + S('offer_seconds') * 1000).toISOString() });
      cands.splice(cands.indexOf(pick.c), 1);
      ctx.push?.toCourier(pick.c.id, { title: `Yangi buyurtma · ${Math.max(o.delivery_fee, S('courier_min_fee')) + levelOf(pick.c).bonus} so'm`, body: `${placeOf(o).name || ''} → ${o.address || ''}`.slice(0, 120), data: { type: 'offer', id: o.id } });
      ping(o);
    }
  }
  setInterval(() => { try { dispatchTick(); } catch (e) { console.error('Taqsimlash:', e.message); } }, Number(process.env.DISPATCH_MS || 2000)).unref();

  // ======================= PLATFORMA: KURYERLAR =======================
  route('GET', '/api/platform/couriers', null, ({ req }) => {
    tenant.platAuth(req);
    return db.prepare('SELECT * FROM couriers ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, id DESC').all().map((c) => ({ ...meView(c), loc_at: c.loc_at, created_at: c.created_at, submitted_at: c.submitted_at, busy: !!activeOrder(c.id) }));
  });
  route('GET', '/api/platform/couriers/:id', null, ({ req, p }) => {
    tenant.platAuth(req);
    const c = getC(int(p.id, 'id')) || fail(404, 'Kuryer topilmadi');
    return { ...meView(c), docs: db.prepare('SELECT kind, data, created_at FROM courier_docs WHERE courier_id=?').all(c.id),
      moves: db.prepare('SELECT * FROM courier_moves WHERE courier_id=? ORDER BY id DESC LIMIT 100').all(c.id), declines: c.declines, releases: c.releases, no_shows: c.no_shows };
  });
  route('POST', '/api/platform/couriers/:id/status', null, ({ req, p, body }) => {
    tenant.platAuth(req);
    const c = getC(int(p.id, 'id')) || fail(404, 'Kuryer topilmadi');
    const reason = str(body.reason, 'Sabab', { required: false, max: 200 });
    const to = { approve: 'probation', reject: 'rejected', block: 'blocked', unblock: c.completed >= S('probation_orders') ? 'active' : 'probation' }[body.action] || fail(400, "Amal noto'g'ri");
    if (body.action === 'approve' && c.status !== 'pending') fail(409, 'Faqat yuborilgan ariza tasdiqlanadi');
    if (['reject', 'block'].includes(body.action) && !reason) fail(400, 'Sababni yozing');
    db.prepare(`UPDATE couriers SET status=?, status_reason=?, online=CASE WHEN ? IN ('blocked','rejected') THEN 0 ELSE online END${body.action === 'approve' ? ', approved_at=?' : ''} WHERE id=?`)
      .run(...[to, reason, to, ...(body.action === 'approve' ? [now()] : []), c.id]);
    return meView(getC(c.id));
  });
  route('POST', '/api/platform/couriers/:id/myid', null, ({ req, p, body }) => {
    tenant.platAuth(req); const c = getC(int(p.id, 'id')) || fail(404, 'Kuryer topilmadi');
    db.prepare('UPDATE couriers SET myid_verified=? WHERE id=?').run(body.verified ? 1 : 0, c.id); return meView(getC(c.id));
  });
  // Pul: depozit, naqd qabul qilish (kunlik hisob), kuryerga to'lash, bonus, jarima
  route('POST', '/api/platform/couriers/:id/money', null, ({ req, p, body }) => {
    tenant.platAuth(req);
    const c = getC(int(p.id, 'id')) || fail(404, 'Kuryer topilmadi');
    const amount = int(body.amount, 'Summa', { min: 1, max: 1e9 }), note = str(body.note, 'Izoh', { required: false, max: 200 });
    const sign = { deposit: 1, deposit_return: -1, cash_in: 1, payout: -1, bonus: 1, penalty: -1 }[body.type] ?? fail(400, "Turi noto'g'ri");
    if (body.type.startsWith('deposit')) {
      if (sign < 0 && amount > c.deposit) fail(400, 'Depozitdan ortiq');
      db.prepare('UPDATE couriers SET deposit=deposit+? WHERE id=?').run(sign * amount, c.id);
      move(c.id, 'deposit', sign * amount, null, note || (sign > 0 ? 'Depozit qabul qilindi' : 'Depozit qaytarildi'));
    } else {
      if (body.type === 'cash_in' && amount > money(c.id).hand) fail(400, "Kuryer qo'lidagi naqddan ortiq");
      move(c.id, body.type, sign * amount, null, note);
    }
    return meView(getC(c.id));
  });
  route('GET', '/api/platform/fund', null, ({ req }) => {
    tenant.platAuth(req);
    return { balance: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM fund_moves').get().s, moves: db.prepare('SELECT * FROM fund_moves ORDER BY id DESC LIMIT 100').all() };
  });
  // Nizo/isbot uchun rasmlar (8-etapda nizolar paneli ishlatadi)
  route('GET', '/api/platform/orders/:id/photos', null, ({ req, p }) => { tenant.platAuth(req); return db.prepare('SELECT kind, data, lat, lng, at FROM delivery_photos WHERE order_id=? ORDER BY id').all(int(p.id, 'id')); });

  return { dispatchTick, LEVELS, money, getC }; // money, getC — 10-etap: akkauntni o'chirishda hisob tekshiruvi
};
