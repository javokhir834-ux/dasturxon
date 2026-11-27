// 8-etap: Platforma admin — restoranlar bilan hisob-kitob (akt), nizolar (isbotlar, aybdor, kompensatsiya, undirish, bosqichli choralar, e'tiroz),
// qaytarishlar (refund_due, kompensatsiyalar), umumiy qora ro'yxat, firibgarlik belgilari, platforma statistikasi, platforma jurnali.

import type { Ctx } from '../core/context.ts';
export default function platform(ctx: Ctx) {
  const { db, route, ROLES, int, str, fail, audit, now, tenant, broadcast, dlv } = ctx;
  const { ext, getRow, tokHash, phoneNorm } = dlv;
  const S = (k) => Number(tenant.setting(k));

  db.exec(`
  CREATE TABLE IF NOT EXISTS settlements (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, date_to TEXT, orders INTEGER DEFAULT 0, food INTEGER DEFAULT 0,
    commission INTEGER DEFAULT 0, own_cash INTEGER DEFAULT 0, adjustments INTEGER DEFAULT 0, payable INTEGER DEFAULT 0, status TEXT DEFAULT 'open',
    method TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT, paid_at TEXT);
  CREATE TABLE IF NOT EXISTS biz_adjustments (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, amount INTEGER NOT NULL, reason TEXT DEFAULT '', dispute_id INTEGER, settlement_id INTEGER, at TEXT);
  CREATE TABLE IF NOT EXISTS disputes (id INTEGER PRIMARY KEY, order_id INTEGER, business_id INTEGER, courier_id INTEGER, app_user_id INTEGER,
    opened_by TEXT NOT NULL, against TEXT DEFAULT '', category TEXT NOT NULL, text TEXT DEFAULT '', amount INTEGER DEFAULT 0, status TEXT DEFAULT 'open',
    guilty TEXT DEFAULT '', compensation INTEGER DEFAULT 0, recover INTEGER DEFAULT 0, measure TEXT DEFAULT '', measure_amount INTEGER DEFAULT 0, resolution TEXT DEFAULT '',
    resolved_at TEXT, appeal_status TEXT DEFAULT 'none', appeal_text TEXT DEFAULT '', appeal_at TEXT, appeal_note TEXT DEFAULT '', created_at TEXT);
  CREATE INDEX IF NOT EXISTS idx_disp_order ON disputes(order_id);
  CREATE TABLE IF NOT EXISTS dispute_notes (id INTEGER PRIMARY KEY, dispute_id INTEGER NOT NULL, author TEXT NOT NULL, text TEXT DEFAULT '', photo TEXT DEFAULT '', at TEXT);
  CREATE TABLE IF NOT EXISTS refunds (id INTEGER PRIMARY KEY, order_id INTEGER, dispute_id INTEGER, phone TEXT, amount INTEGER NOT NULL, reason TEXT DEFAULT '',
    status TEXT DEFAULT 'pending', method TEXT DEFAULT '', note TEXT DEFAULT '', created_at TEXT, done_at TEXT);
  CREATE TABLE IF NOT EXISTS blacklist (id INTEGER PRIMARY KEY, phone TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT DEFAULT '', at TEXT, UNIQUE(phone, kind));
  CREATE TABLE IF NOT EXISTS platform_log (id INTEGER PRIMARY KEY, action TEXT NOT NULL, entity TEXT, entity_id INTEGER, details TEXT, at TEXT);
  `);

  const CAT = { missing: 'Taom yetishmaydi', wrong: 'Boshqa taom keldi', damaged: 'Paket ochilgan / shikastlangan', cold: 'Taom sovuq / sifatsiz', late: 'Juda kech keldi',
    not_delivered: 'Buyurtma kelmadi', rude: "Qo'pol muomala", payment: "To'lov muammosi", restaurant_delay: 'Restoran kechiktirdi', customer_abuse: 'Mijoz bilan muammo',
    block_appeal: "Blokdan e'tiroz", other: 'Boshqa' };
  const PARTIES = ['restaurant', 'courier', 'customer', 'platform', 'none'];
  const log = (action, entity, id, details: Record<string, any> = {}) => db.prepare('INSERT INTO platform_log (action,entity,entity_id,details,at) VALUES (?,?,?,?,?)').run(action, entity, id, JSON.stringify(details), now());
  const fund = (amount, order_id, note) => amount && db.prepare('INSERT INTO fund_moves (amount,order_id,note,at) VALUES (?,?,?,?)').run(amount, order_id, note, now());
  const cmove = (cid, type, amount, order_id, note) => db.prepare('INSERT INTO courier_moves (courier_id,type,amount,order_id,note,at) VALUES (?,?,?,?,?,?)').run(cid, type, amount, order_id, note, now());
  const photoOf = (v) => { const d = String(v || ''); if (!d) return ''; if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(d) || d.length > 700000) fail(400, "Rasm noto'g'ri yoki juda katta"); return d; };
  const bearer = (req) => { const h = req.headers.authorization || ''; return h.startsWith('Bearer ') ? h.slice(7) : ''; };
  const appUser = (req) => {
    const t = bearer(req); const s = t && db.prepare('SELECT user_id FROM app_sessions WHERE token_hash=?').get(tokHash(t));
    const u = s && db.prepare('SELECT * FROM app_users WHERE id=?').get(s.user_id);
    if (!u) fail(401, 'Telefon orqali kiring'); if (u.blocked) fail(403, 'Akkaunt bloklangan'); return u;
  };
  const courierOfReq = (req) => {
    const t = bearer(req); const s = t && db.prepare('SELECT courier_id FROM courier_sessions WHERE token_hash=?').get(tokHash(t));
    return (s && db.prepare('SELECT * FROM couriers WHERE id=?').get(s.courier_id)) || fail(401, 'Telefon orqali kiring');
  };
  const finishedAt = (o) => o.delivered_at || o.updated_at;
  const dayEnd = (d) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) fail(400, "Sana noto'g'ri"); return new Date(`${d}T23:59:59.999`).toISOString(); };
  const range = (url) => {
    const f = new Date(`${url.searchParams.get('from')}T00:00:00`), t = new Date(`${url.searchParams.get('to')}T23:59:59.999`);
    if (isNaN(+f) || isNaN(+t)) fail(400, "Sana noto'g'ri"); return [f.toISOString(), t.toISOString()];
  };

  // ======================= QORA RO'YXAT =======================
  ext.denied = (kind, phone) => db.prepare('SELECT reason FROM blacklist WHERE phone=? AND kind=?').get(phone, kind) || null;
  function blacklistAdd(phone, kind, reason) {
    db.prepare('INSERT INTO blacklist (phone,kind,reason,at) VALUES (?,?,?,?) ON CONFLICT(phone,kind) DO UPDATE SET reason=excluded.reason').run(phone, kind, reason, now());
    if (kind === 'customer') {
      const u = db.prepare('SELECT id FROM app_users WHERE phone=?').get(phone);
      if (u) { db.prepare('UPDATE app_users SET blocked=1 WHERE id=?').run(u.id); db.prepare('DELETE FROM app_sessions WHERE user_id=?').run(u.id); }
    } else {
      const c = db.prepare('SELECT id FROM couriers WHERE phone=?').get(phone);
      if (c) { db.prepare("UPDATE couriers SET status='blocked', online=0, status_reason=? WHERE id=?").run("Qora ro'yxat: " + reason, c.id); db.prepare('DELETE FROM courier_sessions WHERE courier_id=?').run(c.id); }
    }
    log('blacklist_add', kind, null, { phone, reason });
  }

  // ======================= XAVF (firibgarlik belgilari) =======================
  const since = (days) => new Date(Date.now() - days * 864e5).toISOString();
  function customerRisk(u) {
    if (!u) return { score: 0, reasons: [] };
    const d = db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(compensation),0) comp, SUM(CASE WHEN created_at>? THEN 1 ELSE 0 END) recent FROM disputes WHERE app_user_id=? AND opened_by='customer'`).get(since(30), u.id);
    const spent = db.prepare("SELECT COALESCE(SUM(total),0) s FROM delivery_orders WHERE app_user_id=? AND status='delivered'").get(u.id).s;
    const r = [];
    if (u.no_shows >= 1) r.push(`${u.no_shows} marta buyurtmani olmagan`);
    if (u.debt > 0) r.push(`qarzi ${u.debt} so'm`);
    if (u.false_claims > 0) r.push(`${u.false_claims} ta asossiz shikoyat`);
    if (d.recent >= 3) r.push(`30 kunda ${d.recent} ta shikoyat`);
    if (d.comp > 0 && d.comp > spent * 0.3) r.push('kompensatsiya ulushi yuqori (>30%)');
    if (u.cancels >= 3) r.push(`${u.cancels} marta bekor qilgan`);
    return { score: r.length + (u.false_claims >= 2 ? 2 : 0) + (u.no_shows >= 3 ? 1 : 0), reasons: r, claims: d.n, compensation: d.comp, spent };
  }
  const strikesOf = (cid) => db.prepare("SELECT COUNT(*) c FROM disputes WHERE courier_id=? AND guilty='courier' AND status='resolved' AND appeal_status!='accepted' AND resolved_at>?").get(cid, since(90)).c;
  function courierRisk(c) {
    const r = [];
    const done = c.completed + c.no_shows;
    if (done >= 7 && c.no_shows / done >= 0.15) r.push(`"mijoz olmadi" ulushi ${Math.round((c.no_shows / done) * 100)}%`);
    if (c.releases >= 5) r.push(`${c.releases} marta voz kechgan`);
    const s = strikesOf(c.id); if (s >= 2) r.push(`90 kunda ${s} ta nizoda aybdor`);
    if (c.ratings >= 5 && c.rating < 4.5) r.push(`reyting ${c.rating.toFixed(2)}`);
    return { score: r.length, reasons: r, strikes: s };
  }
  // POS doskasi: yangi buyurtmada mijoz xavfi
  ext.riskOf = (o) => (o.app_user_id ? customerRisk(db.prepare('SELECT * FROM app_users WHERE id=?').get(o.app_user_id)).reasons : []);

  // ======================= HISOB-KITOB =======================
  // Restoran ulushi: taom (+ o'zi yetkazgan bo'lsa yetkazish narxi) − komissiya; restoran o'zi olgan naqd ayiriladi.
  function line(o) {
    const own = !o.courier_id, paid = o.payment_status === 'paid' ? o.paid_amount || 0 : 0, foodPaid = paid - (o.debt_amount || 0);
    if (o.status === 'delivered') {
      const food = o.subtotal + (own ? o.delivery_fee : 0), ownCash = own ? Math.max(0, o.total - paid) : 0;
      return { id: o.id, status: o.status, at: finishedAt(o), food, commission: o.commission, own_cash: ownCash, net: food - o.commission - ownCash, paid, total: o.total };
    }
    // no_show: oldindan to'langan bo'lsa restoran pulini oladi, aks holda 0 (komissiya ham yo'q)
    const got = foodPaid >= o.subtotal;
    return { id: o.id, status: o.status, at: finishedAt(o), food: got ? o.subtotal : 0, commission: got ? o.commission : 0, own_cash: 0, net: got ? o.subtotal - o.commission : 0, paid, total: o.total };
  }
  const sumLines = (lines, adj) => {
    const t = { orders: lines.length, food: 0, commission: 0, own_cash: 0, adjustments: adj.reduce((s, a) => s + a.amount, 0) };
    for (const l of lines) { t.food += l.food; t.commission += l.commission; t.own_cash += l.own_cash; }
    return { ...t, payable: t.food - t.commission - t.own_cash + t.adjustments };
  };
  const unsettled = (b, to = '9999') => {
    const lines = db.prepare("SELECT * FROM delivery_orders WHERE business_id=? AND status IN ('delivered','no_show') AND settlement_id IS NULL AND COALESCE(delivered_at,updated_at)<=? ORDER BY id").all(b, to).map(line);
    const adj = db.prepare('SELECT * FROM biz_adjustments WHERE business_id=? AND settlement_id IS NULL AND at<=? ORDER BY id').all(b, to);
    return { lines, adj, ...sumLines(lines, adj) };
  };
  function settlementView(st) {
    const lines = db.prepare('SELECT * FROM delivery_orders WHERE settlement_id=? ORDER BY id').all(st.id).map(line);
    return { ...st, business: db.prepare('SELECT name, code FROM businesses WHERE id=?').get(st.business_id), lines, adj: db.prepare('SELECT * FROM biz_adjustments WHERE settlement_id=? ORDER BY id').all(st.id) };
  }
  route('GET', '/api/platform/settle', null, ({ req }) => {
    tenant.platAuth(req);
    const biz = db.prepare(`SELECT id, name, code FROM businesses WHERE id IN (SELECT business_id FROM delivery_orders WHERE status IN ('delivered','no_show') UNION SELECT business_id FROM biz_adjustments) ORDER BY name`).all()
      .map((b) => { const u = unsettled(b.id); delete u.lines; delete u.adj; return { ...b, ...u, open_acts: db.prepare("SELECT COALESCE(SUM(payable),0) s, COUNT(*) c FROM settlements WHERE business_id=? AND status='open'").get(b.id) }; });
    const acts = db.prepare('SELECT s.*, b.name business_name FROM settlements s JOIN businesses b ON b.id=s.business_id ORDER BY s.id DESC LIMIT 200').all();
    const cour = db.prepare("SELECT c.id, c.name, c.phone, COALESCE(SUM(m.amount),0) balance FROM couriers c JOIN courier_moves m ON m.courier_id=c.id AND m.type!='deposit' GROUP BY c.id HAVING balance!=0 ORDER BY balance DESC").all();
    return { businesses: biz, acts, couriers: cour };
  });
  route('POST', '/api/platform/settle/:id', null, ({ req, p, body }) => {
    tenant.platAuth(req);
    const b = db.prepare('SELECT id, name FROM businesses WHERE id=?').get(int(p.id, 'id')) || fail(404, 'Biznes topilmadi');
    const to = dayEnd(body.date_to);
    const u = unsettled(b.id, to);
    if (!u.lines.length && !u.adj.length) fail(409, "Bu sanagacha hisob-kitob qilinmagan buyurtma yo'q");
    db.exec('BEGIN IMMEDIATE');
    try {
      const sid = db.prepare('INSERT INTO settlements (business_id,date_to,orders,food,commission,own_cash,adjustments,payable,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(b.id, body.date_to, u.orders, u.food, u.commission, u.own_cash, u.adjustments, u.payable, now()).lastInsertRowid;
      for (const l of u.lines) db.prepare('UPDATE delivery_orders SET settlement_id=? WHERE id=?').run(sid, l.id);
      for (const a of u.adj) db.prepare('UPDATE biz_adjustments SET settlement_id=? WHERE id=?').run(sid, a.id);
      db.exec('COMMIT');
      log('settlement_create', 'settlement', sid, { business: b.id, payable: u.payable });
      return settlementView(db.prepare('SELECT * FROM settlements WHERE id=?').get(sid));
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });
  const actOf = (id) => db.prepare('SELECT * FROM settlements WHERE id=?').get(int(id, 'id')) || fail(404, 'Akt topilmadi');
  route('GET', '/api/platform/settlements/:id', null, ({ req, p }) => { tenant.platAuth(req); return settlementView(actOf(p.id)); });
  route('POST', '/api/platform/settlements/:id/paid', null, ({ req, p, body }) => {
    tenant.platAuth(req); const st = actOf(p.id);
    if (st.status !== 'open') fail(409, "Akt allaqachon yopilgan");
    db.prepare("UPDATE settlements SET status='paid', method=?, note=?, paid_at=? WHERE id=?").run(str(body.method, 'Usul', { required: false, max: 30 }) || "o'tkazma", str(body.note, 'Izoh', { required: false, max: 200 }), now(), st.id);
    log('settlement_paid', 'settlement', st.id, { payable: st.payable, method: body.method });
    broadcast(st.business_id, 'delivery', {});
    return settlementView(actOf(st.id));
  });
  route('POST', '/api/platform/settlements/:id/cancel', null, ({ req, p }) => {
    tenant.platAuth(req); const st = actOf(p.id);
    if (st.status !== 'open') fail(409, "To'langan aktni bekor qilib bo'lmaydi");
    db.prepare('UPDATE delivery_orders SET settlement_id=NULL WHERE settlement_id=?').run(st.id);
    db.prepare('UPDATE biz_adjustments SET settlement_id=NULL WHERE settlement_id=?').run(st.id);
    db.prepare("UPDATE settlements SET status='cancelled' WHERE id=?").run(st.id);
    log('settlement_cancel', 'settlement', st.id, {}); return { ok: true };
  });
  route('POST', '/api/platform/businesses/:id/adjust', null, ({ req, p, body }) => {
    tenant.platAuth(req);
    const b = db.prepare('SELECT id FROM businesses WHERE id=?').get(int(p.id, 'id')) || fail(404, 'Biznes topilmadi');
    const amount = int(body.amount, 'Summa', { min: -1e9, max: 1e9 }); if (!amount) fail(400, 'Summa 0 bo\'lmasin');
    const reason = str(body.reason, 'Sabab', { max: 200 });
    db.prepare('INSERT INTO biz_adjustments (business_id,amount,reason,at) VALUES (?,?,?,?)').run(b.id, amount, reason, now());
    log('biz_adjust', 'business', b.id, { amount, reason }); return { ok: true };
  });
  // Restoran (POS) o'z hisob-kitobini ko'radi
  route('GET', '/api/delivery/settlements', ROLES.MANAGE, ({ user }) => {
    const u = unsettled(user.business_id);
    return { unsettled: { ...u, lines: u.lines.slice(-100) }, acts: db.prepare("SELECT * FROM settlements WHERE business_id=? AND status!='cancelled' ORDER BY id DESC LIMIT 50").all(user.business_id),
      commission_percent: S('commission_percent') };
  });
  route('GET', '/api/delivery/settlements/:id', ROLES.MANAGE, ({ user, p }) => {
    const st = actOf(p.id); if (st.business_id !== user.business_id) fail(404, 'Akt topilmadi'); return settlementView(st);
  });

  // ======================= NIZOLAR =======================
  const dOf = (id) => db.prepare('SELECT * FROM disputes WHERE id=?').get(int(id, 'id')) || fail(404, 'Nizo topilmadi');
  const notesOf = (id, withPhoto = true) => db.prepare(`SELECT id, author, text, ${withPhoto ? 'photo' : "CASE WHEN photo!='' THEN 1 ELSE 0 END photo"}, at FROM dispute_notes WHERE dispute_id=? ORDER BY id`).all(id);
  const addNote = (did, author, text, photo) => db.prepare('INSERT INTO dispute_notes (dispute_id,author,text,photo,at) VALUES (?,?,?,?,?)').run(did, author, text || '', photo || '', now());
  function open({ o, by, against = '', category, text, amount = 0, photo, courier_id }: Record<string, any>) {
    if (!CAT[category]) fail(400, 'Muammo turini tanlang');
    if (o && db.prepare("SELECT 1 FROM disputes WHERE order_id=? AND opened_by=? AND status='open'").get(o.id, by)) fail(409, "Bu buyurtma bo'yicha ochiq murojaatingiz bor");
    const t = str(text, 'Tavsif', { max: 1000 });
    const id = db.prepare(`INSERT INTO disputes (order_id,business_id,courier_id,app_user_id,opened_by,against,category,text,amount,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(o?.id ?? null, o?.business_id ?? null, o?.courier_id ?? courier_id ?? null, o?.app_user_id ?? null, by, against, category, t, amount, now()).lastInsertRowid;
    if (photo) addNote(id, by, '', photo);
    if (o) broadcast(o.business_id, 'delivery', { dispute: id });
    return id;
  }
  const partyView = (d, who) => ({ id: d.id, order_id: d.order_id, opened_by: d.opened_by, against: d.against, category: d.category, category_name: CAT[d.category], text: d.text, amount: d.amount,
    status: d.status, guilty: d.guilty, compensation: d.compensation, recover: who !== 'customer' && d.guilty === who ? d.recover : undefined, measure: who === 'courier' ? d.measure : undefined,
    resolution: d.resolution, resolved_at: d.resolved_at, created_at: d.created_at, appeal_status: d.appeal_status, appeal_note: d.appeal_note,
    can_appeal: canAppeal(d, who), notes: notesOf(d.id, false) });
  const canAppeal = (d, who) => d.status === 'resolved' && d.guilty === who && ['restaurant', 'courier'].includes(who) && d.appeal_status === 'none' && Date.now() - +new Date(d.resolved_at) < S('appeal_days') * 864e5;
  function appeal(d, who, text) {
    if (!canAppeal(d, who)) fail(409, "E'tiroz bildirib bo'lmaydi (muddat o'tgan yoki allaqachon bildirilgan)");
    db.prepare("UPDATE disputes SET appeal_status='open', appeal_text=?, appeal_at=? WHERE id=?").run(str(text, "E'tiroz matni", { max: 1000 }), now(), d.id);
    log('appeal_open', 'dispute', d.id, { by: who });
  }

  // --- Mijoz ---
  const prevExtra = ext.publicExtra;
  ext.publicExtra = (o) => {
    const d = db.prepare("SELECT * FROM disputes WHERE order_id=? AND opened_by='customer' ORDER BY id DESC LIMIT 1").get(o.id);
    const canClaim = !d && ['delivered', 'no_show'].includes(o.status) && Date.now() - +new Date(finishedAt(o)) < S('dispute_days') * 864e5;
    return { ...prevExtra(o), claim: d ? partyView(d, 'customer') : null, can_claim: canClaim };
  };
  route('POST', '/api/c/orders/:id/claim', null, ({ req, p, body }) => {
    const u = appUser(req); const o = getRow(int(p.id, 'id'));
    if (!o || o.app_user_id !== u.id) fail(404, 'Buyurtma topilmadi');
    if (!['delivered', 'no_show'].includes(o.status)) fail(409, 'Shikoyat faqat yakunlangan buyurtmaga');
    if (Date.now() - +new Date(finishedAt(o)) > S('dispute_days') * 864e5) fail(409, `Shikoyat muddati (${S('dispute_days')} kun) o'tgan`);
    if (db.prepare("SELECT 1 FROM disputes WHERE order_id=? AND opened_by='customer'").get(o.id)) fail(409, "Bu buyurtma bo'yicha shikoyat yuborilgan");
    const amount = int(body.amount ?? 0, 'Summa', { min: 0, max: o.total });
    const id = open({ o, by: 'customer', category: body.category, text: body.text, amount, photo: photoOf(body.photo) });
    return partyView(dOf(id), 'customer');
  });
  route('POST', '/api/c/claims/:id/note', null, ({ req, p, body }) => {
    const u = appUser(req); const d = dOf(p.id);
    if (d.app_user_id !== u.id || d.opened_by !== 'customer') fail(404, 'Nizo topilmadi');
    if (d.status !== 'open') fail(409, "Nizo yopilgan");
    addNote(d.id, 'customer', str(body.text, 'Matn', { required: false, max: 1000 }), photoOf(body.photo)); return partyView(dOf(d.id), 'customer');
  });

  // --- Restoran (POS) ---
  const myD = (user, id) => { const d = dOf(id); if (d.business_id !== user.business_id) fail(404, 'Nizo topilmadi'); return d; };
  route('GET', '/api/delivery/disputes', ROLES.MANAGE, ({ user }) =>
    db.prepare('SELECT * FROM disputes WHERE business_id=? ORDER BY id DESC LIMIT 100').all(user.business_id).map((d) => partyView(d, 'restaurant')));
  route('POST', '/api/delivery/disputes', ROLES.MANAGE, ({ user, body }) => {
    const o = getRow(int(body.order_id, 'Buyurtma'));
    if (!o || o.business_id !== user.business_id) fail(404, 'Buyurtma topilmadi');
    const against = ['courier', 'customer', 'platform'].includes(body.against) ? body.against : fail(400, 'Kimga nisbatan?');
    if (against === 'courier' && !o.courier_id) fail(400, 'Bu buyurtmada platforma kuryeri yo\'q');
    const id = open({ o, by: 'restaurant', against, category: body.category, text: body.text, photo: photoOf(body.photo) });
    audit(user, 'dispute_open', 'disputes', id, { order_id: o.id, against, category: body.category });
    return partyView(dOf(id), 'restaurant');
  });
  route('POST', '/api/delivery/disputes/:id/note', ROLES.MANAGE, ({ user, p, body }) => {
    const d = myD(user, p.id); if (d.status !== 'open' && d.appeal_status !== 'open') fail(409, 'Nizo yopilgan');
    addNote(d.id, 'restaurant', str(body.text, 'Matn', { required: false, max: 1000 }), photoOf(body.photo));
    audit(user, 'dispute_note', 'disputes', d.id, {}); return partyView(dOf(d.id), 'restaurant');
  });
  route('POST', '/api/delivery/disputes/:id/appeal', ROLES.MANAGE, ({ user, p, body }) => {
    const d = myD(user, p.id); appeal(d, 'restaurant', body.text); audit(user, 'dispute_appeal', 'disputes', d.id, {}); return partyView(dOf(d.id), 'restaurant');
  });

  // --- Kuryer ---
  route('GET', '/api/k/disputes', null, ({ req }) => {
    const c = courierOfReq(req);
    return db.prepare('SELECT * FROM disputes WHERE courier_id=? ORDER BY id DESC LIMIT 50').all(c.id).map((d) => partyView(d, 'courier'));
  });
  route('POST', '/api/k/disputes', null, ({ req, body }) => {
    const c = courierOfReq(req);
    if (body.category === 'block_appeal') {
      if (c.status !== 'blocked') fail(409, 'Hisobingiz bloklanmagan');
      if (db.prepare("SELECT 1 FROM disputes WHERE courier_id=? AND category='block_appeal' AND status='open'").get(c.id)) fail(409, "E'tirozingiz ko'rib chiqilmoqda");
      return partyView(dOf(open({ by: 'courier', against: 'platform', category: 'block_appeal', text: body.text, courier_id: c.id })), 'courier');
    }
    const o = getRow(int(body.order_id, 'Buyurtma'));
    if (!o || o.courier_id !== c.id) fail(404, 'Buyurtma topilmadi');
    const against = ['restaurant', 'customer'].includes(body.against) ? body.against : fail(400, 'Kimga nisbatan?');
    return partyView(dOf(open({ o, by: 'courier', against, category: body.category, text: body.text, photo: photoOf(body.photo) })), 'courier');
  });
  route('POST', '/api/k/disputes/:id/note', null, ({ req, p, body }) => {
    const c = courierOfReq(req); const d = dOf(p.id); if (d.courier_id !== c.id) fail(404, 'Nizo topilmadi');
    if (d.status !== 'open' && d.appeal_status !== 'open') fail(409, 'Nizo yopilgan');
    addNote(d.id, 'courier', str(body.text, 'Matn', { required: false, max: 1000 }), photoOf(body.photo)); return partyView(dOf(d.id), 'courier');
  });
  route('POST', '/api/k/disputes/:id/appeal', null, ({ req, p, body }) => {
    const c = courierOfReq(req); const d = dOf(p.id); if (d.courier_id !== c.id) fail(404, 'Nizo topilmadi');
    appeal(d, 'courier', body.text); return partyView(dOf(d.id), 'courier');
  });

  // --- Platforma ---
  route('GET', '/api/platform/disputes', null, ({ req, url }) => {
    tenant.platAuth(req);
    const st = url.searchParams.get('status') || 'open';
    const where = st === 'open' ? "d.status='open' OR d.appeal_status='open'" : st === 'all' ? '1=1' : "d.status!='open' AND d.appeal_status!='open'";
    return db.prepare(`SELECT d.*, b.name business_name, c.name courier_name, u.phone customer_phone FROM disputes d LEFT JOIN businesses b ON b.id=d.business_id
      LEFT JOIN couriers c ON c.id=d.courier_id LEFT JOIN app_users u ON u.id=d.app_user_id WHERE ${where} ORDER BY d.id DESC LIMIT 300`).all()
      .map((d) => ({ ...d, category_name: CAT[d.category], risk: d.opened_by === 'customer' ? customerRisk(db.prepare('SELECT * FROM app_users WHERE id=?').get(d.app_user_id)).reasons : [] }));
  });
  route('GET', '/api/platform/disputes/:id', null, ({ req, p }) => {
    tenant.platAuth(req);
    const d = dOf(p.id), o = d.order_id ? getRow(d.order_id) : null;
    const c = d.courier_id ? db.prepare('SELECT * FROM couriers WHERE id=?').get(d.courier_id) : null;
    const u = d.app_user_id ? db.prepare('SELECT * FROM app_users WHERE id=?').get(d.app_user_id) : null;
    const timeline = o ? [['Buyurtma berildi', o.created_at], ['Restoran qabul qildi', o.accepted_at], ['Taom tayyor', o.ready_at], ['Kuryer biriktirildi', o.assigned_at], ['Kuryer oldi (plomba)', o.picked_at],
      ['Kuryer yetib keldi', o.arrived_at], ["Kuryer qo'ng'iroq qildi", o.call_at], ['Yetkazildi', o.delivered_at], [`Yakun: ${{ delivered: 'yetkazildi', no_show: 'mijoz olmadi', rejected: 'rad etildi', cancelled: 'bekor qilindi' }[o.status] || o.status}`, o.updated_at]].filter(([, t]) => t) : [];
    return { ...d, category_name: CAT[d.category], notes: notesOf(d.id), timeline,
      order: o && { id: o.id, status: o.status, total: o.total, subtotal: o.subtotal, delivery_fee: o.delivery_fee, paid_amount: o.paid_amount, payment_status: o.payment_status, items: o.items,
        address: o.address, lat: o.lat, lng: o.lng, note: o.note, courier_rating: o.courier_rating, rating_comment: o.rating_comment, code_attempts: o.code_attempts, own_delivery: o.own_delivery },
      photos: o ? db.prepare('SELECT kind, data, lat, lng, at FROM delivery_photos WHERE order_id=? ORDER BY id').all(o.id) : [],
      business: d.business_id ? db.prepare('SELECT id, name, code FROM businesses WHERE id=?').get(d.business_id) : null,
      courier: c && { id: c.id, name: c.name, phone: c.phone, status: c.status, rating: c.rating, completed: c.completed, ...courierRisk(c) },
      customer: u && { id: u.id, phone: u.phone, name: u.name, completed: u.completed, no_shows: u.no_shows, false_claims: u.false_claims, debt: u.debt, ...customerRisk(u) },
      suggest_measure: c ? ['warn', 'fine', 'block'][Math.min(2, strikesOf(c.id))] : null, fine: S('dispute_fine') };
  });
  function applyMeasure(d, c, measure) {
    if (!c) return { measure: '', amount: 0 };
    if (measure === 'auto') measure = ['warn', 'fine', 'block'][Math.min(2, strikesOf(c.id))]; // bu nizodan oldingi ayblar soni
    if (measure === 'warn') cmove(c.id, 'note', 0, d.order_id, `Ogohlantirish: nizo #${d.id}`);
    if (measure === 'fine') { const f = S('dispute_fine'); cmove(c.id, 'penalty', -f, d.order_id, `Jarima: nizo #${d.id}`); fund(f, d.order_id, `Kuryer jarimasi (nizo #${d.id})`); return { measure, amount: f }; }
    if (measure === 'block') db.prepare("UPDATE couriers SET status='blocked', online=0, status_reason=? WHERE id=?").run(`Nizo #${d.id}: takroriy qoidabuzarlik`, c.id);
    return { measure: ['warn', 'block'].includes(measure) ? measure : '', amount: 0 };
  }
  const unblock = (c) => db.prepare("UPDATE couriers SET status=?, status_reason='' WHERE id=? AND status='blocked'").run(c.completed >= S('probation_orders') ? 'active' : 'probation', c.id);
  route('POST', '/api/platform/disputes/:id/resolve', null, ({ req, p, body }) => {
    tenant.platAuth(req);
    const d = dOf(p.id); if (d.status !== 'open') fail(409, "Nizo allaqachon hal qilingan");
    const o = d.order_id ? getRow(d.order_id) : null;
    const guilty = PARTIES.includes(body.guilty) ? body.guilty : fail(400, 'Aybdorni tanlang');
    const note = str(body.note, 'Qaror izohi', { max: 1000 });
    const comp = int(body.compensation ?? 0, 'Kompensatsiya', { min: 0, max: o ? o.total : 0 });
    const recover = int(body.recover ?? 0, 'Undiriladigan summa', { min: 0, max: o ? o.total : 0 });
    if (comp && !o?.app_user_id) fail(400, "Kompensatsiya faqat mijozga (buyurtma bo'yicha)");
    if (recover && !['restaurant', 'courier'].includes(guilty)) fail(400, 'Undirish faqat restoran yoki kuryerdan');
    if (guilty === 'courier' && !d.courier_id) fail(400, 'Bu nizoda kuryer yo\'q');
    const c = d.courier_id ? db.prepare('SELECT * FROM couriers WHERE id=?').get(d.courier_id) : null;
    db.exec('BEGIN IMMEDIATE');
    try {
      // 1) Mijozga darhol kompensatsiya — kafolat fondidan (aybdordan undirishni kutmasdan)
      if (comp) {
        fund(-comp, o.id, `Nizo #${d.id}: mijozga kompensatsiya`);
        db.prepare('INSERT INTO refunds (order_id,dispute_id,phone,amount,reason,created_at) VALUES (?,?,?,?,?,?)').run(o.id, d.id, o.phone, comp, `Nizo #${d.id}: ${CAT[d.category]}`, now());
      }
      // 2) Aybdordan undirish → fondga qaytadi
      if (recover && guilty === 'restaurant') { db.prepare('INSERT INTO biz_adjustments (business_id,amount,reason,dispute_id,at) VALUES (?,?,?,?,?)').run(d.business_id, -recover, `Nizo #${d.id}: ${CAT[d.category]}`, d.id, now()); fund(recover, o.id, `Nizo #${d.id}: restorandan undirildi`); }
      if (recover && guilty === 'courier') { cmove(c.id, 'penalty', -recover, o.id, `Nizo #${d.id}: zarar undirildi`); fund(recover, o.id, `Nizo #${d.id}: kuryerdan undirildi`); }
      // 3) Kuryerga bosqichli chora (ogohlantirish → jarima → blok) yoki blokdan chiqarish
      let m = { measure: '', amount: 0 };
      if (guilty === 'courier') m = applyMeasure(d, c, ['auto', 'none', 'warn', 'fine', 'block'].includes(body.measure) ? body.measure : 'auto');
      if (body.measure === 'unblock' && c) { unblock(c); m.measure = 'unblock'; }
      // 4) Asossiz shikoyat — mijoz hisobiga; 3 tadan keyin qora ro'yxat
      if (guilty === 'customer' && d.app_user_id) {
        db.prepare('UPDATE app_users SET false_claims=false_claims+1 WHERE id=?').run(d.app_user_id);
        const u = db.prepare('SELECT * FROM app_users WHERE id=?').get(d.app_user_id);
        if (u.false_claims >= 3) blacklistAdd(u.phone, 'customer', `${u.false_claims} ta asossiz shikoyat / nizo`);
      }
      const status = guilty === 'none' && !comp && m.measure !== 'unblock' ? 'rejected' : 'resolved';
      db.prepare('UPDATE disputes SET status=?, guilty=?, compensation=?, recover=?, measure=?, measure_amount=?, resolution=?, resolved_at=? WHERE id=?')
        .run(status, guilty, comp, recover, m.measure, m.amount, note, now(), d.id);
      addNote(d.id, 'platform', note, '');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    log('dispute_resolve', 'dispute', d.id, { guilty, comp, recover, measure: body.measure });
    if (d.business_id) broadcast(d.business_id, 'delivery', { dispute: d.id });
    return dOf(d.id);
  });
  route('POST', '/api/platform/disputes/:id/note', null, ({ req, p, body }) => {
    tenant.platAuth(req); const d = dOf(p.id);
    addNote(d.id, 'platform', str(body.text, 'Matn', { max: 1000 }), ''); return { ok: true };
  });
  // E'tiroz bo'yicha qaror: qabul qilinsa — undirilgan summa, jarima va blok qaytariladi (mijoz kompensatsiyasi o'zgarmaydi)
  route('POST', '/api/platform/disputes/:id/appeal', null, ({ req, p, body }) => {
    tenant.platAuth(req); const d = dOf(p.id);
    if (d.appeal_status !== 'open') fail(409, "Ochiq e'tiroz yo'q");
    const note = str(body.note, 'Izoh', { max: 1000 });
    db.exec('BEGIN IMMEDIATE');
    try {
      if (body.accept) {
        if (d.guilty === 'restaurant' && d.recover) { db.prepare('INSERT INTO biz_adjustments (business_id,amount,reason,dispute_id,at) VALUES (?,?,?,?,?)').run(d.business_id, d.recover, `Nizo #${d.id}: e'tiroz qabul qilindi`, d.id, now()); fund(-d.recover, d.order_id, `Nizo #${d.id}: e'tiroz — restoranga qaytarildi`); }
        if (d.guilty === 'courier') {
          const back = (d.recover || 0) + (d.measure === 'fine' ? d.measure_amount : 0);
          if (back) { cmove(d.courier_id, 'bonus', back, d.order_id, `Nizo #${d.id}: e'tiroz qabul qilindi`); fund(-back, d.order_id, `Nizo #${d.id}: e'tiroz — kuryerga qaytarildi`); }
          if (d.measure === 'block') unblock(db.prepare('SELECT * FROM couriers WHERE id=?').get(d.courier_id));
        }
      }
      db.prepare('UPDATE disputes SET appeal_status=?, appeal_note=? WHERE id=?').run(body.accept ? 'accepted' : 'rejected', note, d.id);
      addNote(d.id, 'platform', `E'tiroz ${body.accept ? 'qabul qilindi' : 'rad etildi'}: ${note}`, '');
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    log('appeal_decide', 'dispute', d.id, { accept: !!body.accept });
    return dOf(d.id);
  });

  // ======================= QAYTARISHLAR =======================
  route('GET', '/api/platform/refunds', null, ({ req }) => {
    tenant.platAuth(req);
    const orders = db.prepare("SELECT d.id, d.phone, d.name, d.paid_amount, d.debt_amount, d.payment_provider, d.status, d.reject_reason, d.updated_at, b.name business_name FROM delivery_orders d JOIN businesses b ON b.id=d.business_id WHERE d.payment_status='refund_due' ORDER BY d.id")
      .all().map((o) => ({ ...o, amount: o.paid_amount - (o.debt_amount || 0) }));
    return { orders, pending: db.prepare("SELECT * FROM refunds WHERE status='pending' ORDER BY id").all(), done: db.prepare("SELECT * FROM refunds WHERE status='done' ORDER BY id DESC LIMIT 100").all() };
  });
  const METHODS = ['payme', 'click', 'karta', 'naqd', "o'tkazma"];
  route('POST', '/api/platform/refunds/order/:id', null, ({ req, p, body }) => {
    tenant.platAuth(req); const o = getRow(int(p.id, 'id'));
    if (!o || o.payment_status !== 'refund_due') fail(409, "Bu buyurtma qaytarish kutmayapti");
    const method = METHODS.includes(body.method) ? body.method : fail(400, 'Usulni tanlang'), amount = o.paid_amount - (o.debt_amount || 0);
    db.prepare("UPDATE delivery_orders SET payment_status='refunded', updated_at=? WHERE id=?").run(now(), o.id);
    db.prepare("INSERT INTO refunds (order_id,phone,amount,reason,status,method,note,created_at,done_at) VALUES (?,?,?,?,'done',?,?,?,?)").run(o.id, o.phone, amount, `Buyurtma ${o.status}`, method, str(body.note, 'Izoh', { required: false, max: 200 }), now(), now());
    log('refund_order', 'order', o.id, { amount, method }); return { ok: true };
  });
  route('POST', '/api/platform/refunds/:id/done', null, ({ req, p, body }) => {
    tenant.platAuth(req);
    const r = db.prepare('SELECT * FROM refunds WHERE id=?').get(int(p.id, 'id')) || fail(404, 'Topilmadi');
    if (r.status !== 'pending') fail(409, "Allaqachon qaytarilgan");
    db.prepare("UPDATE refunds SET status='done', method=?, note=?, done_at=? WHERE id=?").run(METHODS.includes(body.method) ? body.method : fail(400, 'Usulni tanlang'), str(body.note, 'Izoh', { required: false, max: 200 }), now(), r.id);
    log('refund_done', 'refund', r.id, { amount: r.amount }); return { ok: true };
  });

  // ======================= QORA RO'YXAT VA XAVF =======================
  route('GET', '/api/platform/risk', null, ({ req }) => {
    tenant.platAuth(req);
    const customers = db.prepare("SELECT * FROM app_users WHERE no_shows>0 OR debt>0 OR false_claims>0 OR cancels>=3 OR id IN (SELECT app_user_id FROM disputes WHERE opened_by='customer')").all()
      .map((u) => ({ id: u.id, phone: u.phone, name: u.name, completed: u.completed, no_shows: u.no_shows, cancels: u.cancels, debt: u.debt, false_claims: u.false_claims, blocked: !!u.blocked, ...customerRisk(u) }))
      .filter((u) => u.score > 0).sort((a, b) => b.score - a.score);
    const couriers = db.prepare('SELECT * FROM couriers').all().map((c) => ({ id: c.id, phone: c.phone, name: c.name, status: c.status, completed: c.completed, no_shows: c.no_shows, releases: c.releases, ...courierRisk(c) }))
      .filter((c) => c.score > 0).sort((a, b) => b.score - a.score);
    return { customers, couriers, blacklist: db.prepare('SELECT * FROM blacklist ORDER BY id DESC').all() };
  });
  route('POST', '/api/platform/blacklist', null, ({ req, body }) => {
    tenant.platAuth(req);
    const kind = ['customer', 'courier'].includes(body.kind) ? body.kind : fail(400, 'Turini tanlang');
    blacklistAdd(phoneNorm(body.phone), kind, str(body.reason, 'Sabab', { max: 200 })); return { ok: true };
  });
  route('POST', '/api/platform/blacklist/:id/remove', null, ({ req, p }) => {
    tenant.platAuth(req);
    const b = db.prepare('SELECT * FROM blacklist WHERE id=?').get(int(p.id, 'id')) || fail(404, 'Topilmadi');
    db.prepare('DELETE FROM blacklist WHERE id=?').run(b.id);
    if (b.kind === 'customer') db.prepare('UPDATE app_users SET blocked=0 WHERE phone=?').run(b.phone); // kuryer blokdan alohida chiqariladi (Kuryerlar bo'limi)
    log('blacklist_remove', b.kind, b.id, { phone: b.phone }); return { ok: true };
  });

  // ======================= STATISTIKA =======================
  const mins = (a, b) => (a && b ? (+new Date(b) - +new Date(a)) / 60000 : null);
  const avg = (xs) => { const v = xs.filter((x) => x != null && x >= 0); return v.length ? Math.round(v.reduce((t, x) => t + x, 0) / v.length) : null; };
  const ymdLocal = (iso) => { const d = new Date(iso), z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
  route('GET', '/api/platform/stats', null, ({ req, url }) => {
    tenant.platAuth(req);
    const [f, t] = range(url);
    const os = db.prepare("SELECT * FROM delivery_orders WHERE created_at BETWEEN ? AND ? AND status!='awaiting_payment'").all(f, t);
    const dl = os.filter((o) => o.status === 'delivered'), fin = os.filter((o) => ['delivered', 'no_show'].includes(o.status)).map(line);
    const by = (k) => os.filter((o) => o.status === k).length;
    const fm = db.prepare('SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount END),0) inn, COALESCE(SUM(CASE WHEN amount<0 THEN amount END),0) out FROM fund_moves WHERE at BETWEEN ? AND ?').get(f, t);
    const totals: Record<string, any> = {
      orders: os.length, delivered: dl.length, no_show: by('no_show'), rejected: by('rejected'), cancelled: by('cancelled'), active: os.filter((o) => ['new', 'accepted', 'ready', 'on_way'].includes(o.status)).length,
      gmv: dl.reduce((s, o) => s + o.total - (o.debt_amount || 0), 0), food: dl.reduce((s, o) => s + o.subtotal, 0), delivery_fees: dl.reduce((s, o) => s + o.delivery_fee, 0),
      commission: fin.reduce((s, l) => s + l.commission, 0),
      courier_pay: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM courier_moves WHERE type IN ('fee','bonus') AND at BETWEEN ? AND ?").get(f, t).s,
      fund_balance: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM fund_moves').get().s, fund_in: fm.inn, fund_out: fm.out,
      refunds_pending: db.prepare("SELECT COALESCE(SUM(paid_amount-COALESCE(debt_amount,0)),0) s FROM delivery_orders WHERE payment_status='refund_due'").get().s + db.prepare("SELECT COALESCE(SUM(amount),0) s FROM refunds WHERE status='pending'").get().s,
      disputes: db.prepare('SELECT COUNT(*) c FROM disputes WHERE created_at BETWEEN ? AND ?').get(f, t).c, compensation: db.prepare('SELECT COALESCE(SUM(compensation),0) s FROM disputes WHERE resolved_at BETWEEN ? AND ?').get(f, t).s,
      new_customers: db.prepare('SELECT COUNT(*) c FROM app_users WHERE created_at BETWEEN ? AND ?').get(f, t).c,
      avg_total_min: avg(dl.map((o) => mins(o.created_at, o.delivered_at))), avg_prep_min: avg(os.map((o) => mins(o.accepted_at, o.ready_at))),
      avg_wait_min: avg(os.filter((o) => o.courier_id).map((o) => mins(o.ready_at, o.picked_at))), avg_ride_min: avg(dl.filter((o) => o.courier_id).map((o) => mins(o.picked_at, o.delivered_at))),
    };
    totals.avg_check = dl.length ? Math.round(totals.food / dl.length) : 0;
    const days: Record<string, any> = {};
    for (const o of os) { const k = ymdLocal(o.created_at); days[k] = days[k] || { day: k, orders: 0, gmv: 0 }; days[k].orders++; if (o.status === 'delivered') days[k].gmv += o.total - (o.debt_amount || 0); }
    const bizMap: Record<string, any> = {};
    for (const o of os) {
      const b = (bizMap[o.business_id] = bizMap[o.business_id] || { id: o.business_id, orders: 0, delivered: 0, rejected: 0, gmv: 0, commission: 0, mins: [] });
      b.orders++; if (o.status === 'rejected') b.rejected++;
      if (o.status === 'delivered') { b.delivered++; b.gmv += o.total - (o.debt_amount || 0); b.mins.push(mins(o.created_at, o.delivered_at)); }
      if (['delivered', 'no_show'].includes(o.status)) b.commission += line(o).commission;
    }
    const businesses = Object.values(bizMap).map(({ mins: m, ...b }) => ({ ...b, name: db.prepare('SELECT name FROM businesses WHERE id=?').get(b.id)?.name, avg_min: avg(m) })).sort((a, b) => b.gmv - a.gmv);
    const cMap: Record<string, any> = {};
    for (const o of os.filter((x) => x.courier_id)) {
      const c = (cMap[o.courier_id] = cMap[o.courier_id] || { id: o.courier_id, delivered: 0, no_show: 0, ride: [], total: [] });
      if (o.status === 'delivered') { c.delivered++; c.ride.push(mins(o.picked_at, o.delivered_at)); c.total.push(mins(o.assigned_at, o.delivered_at)); }
      if (o.status === 'no_show') c.no_show++;
    }
    const couriers = Object.values(cMap).map(({ ride, total, ...c }) => {
      const r = db.prepare('SELECT name, rating, ratings, declines, releases FROM couriers WHERE id=?').get(c.id) || {};
      return { ...c, ...r, avg_ride_min: avg(ride), avg_total_min: avg(total), strikes: strikesOf(c.id),
        earned: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM courier_moves WHERE courier_id=? AND type IN ('fee','bonus') AND at BETWEEN ? AND ?").get(c.id, f, t).s };
    }).sort((a, b) => b.delivered - a.delivered);
    return { totals, days: Object.values(days).sort((a, b) => a.day.localeCompare(b.day)), businesses, couriers };
  });
  route('GET', '/api/platform/log', null, ({ req }) => { tenant.platAuth(req); return db.prepare('SELECT * FROM platform_log ORDER BY id DESC LIMIT 200').all(); });

  return { line, customerRisk, courierRisk };
};
