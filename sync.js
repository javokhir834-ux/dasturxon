// 5-etap: Lokal server → bulut sinxronizatsiyasi.
// Lokal (restoran) server — asosiy manba: internet uzilsa ham ishlaydi, o'zgarishlar navbatga (sync_outbox) yoziladi va internet bo'lganda bulutga yuboriladi.
// Bulut — nusxa (mirror): ega uydan hisobotlarni ko'radi, xodimlar o'z PINi bilan kirib faqat ko'radi. Bulutdagi nusxaga yozish taqiqlangan.
const crypto = require('crypto');

module.exports = function sync(ctx) {
  const { db, route, ROLES, str, fail, audit, now, tenant, config } = ctx;

  // ---------- Sxema ----------
  const addCol = (t, c) => { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* bor */ } };
  ["sync_url TEXT DEFAULT ''", "sync_key TEXT DEFAULT ''", 'sync_needs_reset INTEGER DEFAULT 0', 'sync_last_ok TEXT', 'sync_last_error TEXT', "sync_cloud_name TEXT DEFAULT ''",
    'sync_key_hash TEXT', 'mirror INTEGER DEFAULT 0', 'last_sync_at TEXT'].forEach((c) => addCol('businesses', c));
  db.exec(`
  CREATE TABLE IF NOT EXISTS sync_outbox (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, t TEXT NOT NULL, row_id INTEGER NOT NULL, op TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_outbox_biz ON sync_outbox(business_id, id);
  CREATE TABLE IF NOT EXISTS sync_map (business_id INTEGER NOT NULL, t TEXT NOT NULL, local_id INTEGER NOT NULL, cloud_id INTEGER NOT NULL, PRIMARY KEY (business_id, t, local_id));
  `);

  // Sinxronlanadigan jadvallar (bog'liqlik tartibida) va ularning tashqi kalitlari: ustun → jadval
  const SPEC = {
    users: {}, delivery_settings: {}, halls: {}, tables: { hall_id: 'halls' }, workshops: {}, categories: {},
    products: { category_id: 'categories', workshop_id: 'workshops' }, modifiers: {}, customers: {}, ingredients: {}, suppliers: {},
    recipe_items: { ingredient_id: 'ingredients', owner_id: (r) => (r.owner_type === 'product' ? 'products' : 'ingredients') },
    shifts: { opened_by: 'users', closed_by: 'users' },
    orders: { shift_id: 'shifts', table_id: 'tables', waiter_id: 'users', closed_by: 'users', customer_id: 'customers', reservation_id: 'reservations' },
    reservations: { table_id: 'tables', customer_id: 'customers', created_by: 'users', order_id: 'orders' },
    order_items: { order_id: 'orders', product_id: 'products', workshop_id: 'workshops', created_by: 'users' },
    payments: { order_id: 'orders', shift_id: 'shifts', user_id: 'users' },
    cash_moves: { shift_id: 'shifts', user_id: 'users' },
    invoices: { supplier_id: 'suppliers', user_id: 'users' },
    stock_moves: { ingredient_id: 'ingredients', user_id: 'users' },
    bonus_moves: { customer_id: 'customers', order_id: 'orders', user_id: 'users' },
    timesheets: { user_id: 'users' },
    payroll_payments: { user_id: 'users', by_user: 'users' },
    audit_log: { user_id: 'users' },
  };
  const TABLES = Object.keys(SPEC);

  // Triggerlar: faqat sinxron yoqilgan biznes uchun navbatga yozadi
  const enabledCond = (alias) => `EXISTS (SELECT 1 FROM businesses b WHERE b.id=${alias}.business_id AND b.sync_key != '')`;
  function installTriggers() { // faqat mavjud jadvallar uchun; keyin yuklanadigan modullar jadval yaratgach qayta chaqiradi
  for (const t of TABLES) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t)) continue;
    db.exec(`CREATE TRIGGER IF NOT EXISTS sync_${t}_ai AFTER INSERT ON ${t} WHEN ${enabledCond('NEW')} BEGIN INSERT INTO sync_outbox (business_id,t,row_id,op) VALUES (NEW.business_id,'${t}',NEW.id,'u'); END;
      CREATE TRIGGER IF NOT EXISTS sync_${t}_au AFTER UPDATE ON ${t} WHEN ${enabledCond('NEW')} BEGIN INSERT INTO sync_outbox (business_id,t,row_id,op) VALUES (NEW.business_id,'${t}',NEW.id,'u'); END;
      CREATE TRIGGER IF NOT EXISTS sync_${t}_ad AFTER DELETE ON ${t} WHEN ${enabledCond('OLD')} BEGIN INSERT INTO sync_outbox (business_id,t,row_id,op) VALUES (OLD.business_id,'${t}',OLD.id,'d'); END;`);
  }
  }
  installTriggers();

  const keyHash = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');
  const newKey = () => 'dxs_' + crypto.randomBytes(20).toString('hex');

  // ======================= LOKAL TOMON =======================
  function enqueueSnapshot(b) {
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM sync_outbox WHERE business_id=?').run(b);
      for (const t of TABLES) db.prepare(`INSERT INTO sync_outbox (business_id,t,row_id,op) SELECT business_id, '${t}', id, 'u' FROM ${t} WHERE business_id=? ORDER BY id`).run(b);
      // Bronga bog'langan buyurtmalar: bron yuborilgandan keyin bog'lanishni tiklash uchun qayta
      db.prepare("INSERT INTO sync_outbox (business_id,t,row_id,op) SELECT business_id, 'orders', id, 'u' FROM orders WHERE business_id=? AND reservation_id IS NOT NULL").run(b);
      db.prepare('UPDATE businesses SET sync_needs_reset=1 WHERE id=?').run(b);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  async function cloudCall(url, key, path, body) {
    const r = await fetch(url.replace(/\/+$/, '') + path, {
      method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Bulut javobi: HTTP ${r.status}`);
    return j;
  }

  const state = {}; // business_id -> { busy, fails, nextAt }
  const tickHooks = []; // (biz, cloudCall) => Promise — masalan, yetkazib berish buyurtmalarini tortish
  const BATCH = 300;
  async function pushOnce(biz) {
    const rows = db.prepare('SELECT * FROM sync_outbox WHERE business_id=? ORDER BY id LIMIT ?').all(biz.id, BATCH);
    if (!rows.length && !biz.sync_needs_reset) return 0;
    // Bir qator bir necha marta o'zgargan bo'lsa — birinchi VA oxirgi o'rnida, eng so'nggi holati bilan yuboriladi.
    // Birinchi o'rin: undan keyin yaratilgan bog'liq qatorlar (masalan taomlar) uni topa olsin.
    // Oxirgi o'rin: o'zi keyinroq yaratilgan qatorga bog'langan bo'lsa (masalan keyin biriktirilgan mijoz), bog'lanish tiklansin.
    const first = new Map(), last = new Map();
    rows.forEach((r, i) => { const k = r.t + ':' + r.row_id; if (!first.has(k)) first.set(k, i); last.set(k, i); });
    const changes = [];
    rows.forEach((r, i) => {
      const k = r.t + ':' + r.row_id;
      if (first.get(k) !== i && last.get(k) !== i) return;
      const row = db.prepare(`SELECT * FROM ${r.t} WHERE id=?`).get(r.row_id);
      changes.push(row ? { t: r.t, id: r.row_id, op: 'u', row } : { t: r.t, id: r.row_id, op: 'd' });
    });
    const res = await cloudCall(biz.sync_url, biz.sync_key, '/api/sync/push', { reset: !!biz.sync_needs_reset, changes });
    const maxId = rows.length ? rows[rows.length - 1].id : 0;
    db.prepare('DELETE FROM sync_outbox WHERE business_id=? AND id<=?').run(biz.id, maxId);
    db.prepare('UPDATE businesses SET sync_needs_reset=0, sync_last_ok=?, sync_last_error=NULL WHERE id=?').run(now(), biz.id);
    if (res.errors) console.error(`Sinxron: bulut ${res.errors} ta qatorni qabul qilmadi`);
    return rows.length;
  }
  async function tick() {
    for (const biz of db.prepare("SELECT * FROM businesses WHERE sync_key != '' AND sync_url != ''").all()) {
      const st = (state[biz.id] ||= { busy: false, fails: 0, nextAt: 0 });
      if (st.busy || st.nextAt > Date.now()) continue;
      st.busy = true;
      try {
        let n, fresh = biz;
        do { n = await pushOnce(fresh); fresh = db.prepare('SELECT * FROM businesses WHERE id=?').get(biz.id); } while (n >= BATCH);
        for (const h of tickHooks) await h(fresh, cloudCall);
        st.fails = 0;
      } catch (e) {
        st.fails++; st.nextAt = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(st.fails, 5));
        db.prepare('UPDATE businesses SET sync_last_error=? WHERE id=?').run(String(e.message || e).slice(0, 200), biz.id);
      } finally { st.busy = false; }
    }
  }
  if (config.MODE !== 'cloud') setInterval(tick, Number(process.env.SYNC_INTERVAL_MS) || 3000).unref();

  route('GET', '/api/admin/sync', ROLES.ADMIN, ({ user }) => {
    const b = db.prepare('SELECT * FROM businesses WHERE id=?').get(user.business_id);
    return { mode: config.MODE, enabled: !!b.sync_key, url: b.sync_url, cloud_name: b.sync_cloud_name, last_ok: b.sync_last_ok, last_error: b.sync_last_error,
      pending: db.prepare('SELECT COUNT(*) c FROM sync_outbox WHERE business_id=?').get(b.id).c, initial: !!b.sync_needs_reset };
  });
  route('POST', '/api/admin/sync', ROLES.ADMIN, async ({ user, body }) => {
    const b = user.business_id;
    if (config.MODE === 'cloud') fail(400, "Bulut serverning o'zi boshqa joyga sinxronlanmaydi");
    if (body.disable) {
      db.prepare("UPDATE businesses SET sync_key='', sync_url='', sync_needs_reset=0, sync_last_error=NULL WHERE id=?").run(b);
      db.prepare('DELETE FROM sync_outbox WHERE business_id=?').run(b);
      audit(user, 'sync_off', 'business', b);
      return { ok: true };
    }
    const url = str(body.url, 'Bulut manzili', { max: 200 });
    if (!/^https?:\/\/[^\s/]+/i.test(url)) fail(400, "Manzil noto'g'ri (masalan https://pos.example.uz)");
    const key = str(body.key, 'Ulash kaliti', { max: 100 });
    let info;
    try { info = await cloudCall(url, key, '/api/sync/ping'); } catch (e) { fail(502, `Bulutga ulanib bo'lmadi: ${e.message}`); }
    db.prepare('UPDATE businesses SET sync_url=?, sync_key=?, sync_cloud_name=?, sync_last_error=NULL WHERE id=?').run(url.replace(/\/+$/, ''), key, info.business, b);
    enqueueSnapshot(b);
    audit(user, 'sync_on', 'business', b, { url, cloud: info.business });
    setTimeout(tick, 100);
    return { ok: true, cloud: info.business };
  });

  // ======================= BULUT TOMON =======================
  const colsCache = {};
  const cols = (t) => (colsCache[t] ||= db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).filter((c) => c !== 'id'));
  const getMap = (b, t, id) => db.prepare('SELECT cloud_id FROM sync_map WHERE business_id=? AND t=? AND local_id=?').get(b, t, id)?.cloud_id;
  const bizByKey = (req) => {
    const h = req.headers.authorization || ''; const k = h.startsWith('Bearer ') ? h.slice(7) : '';
    const b = k && db.prepare('SELECT * FROM businesses WHERE sync_key_hash=?').get(keyHash(k));
    if (!b) fail(401, "Ulash kaliti noto'g'ri yoki bekor qilingan");
    if (tenant.subStatus(b.id).status === 'blocked') fail(403, 'Biznes bloklangan');
    return b;
  };
  route('GET', '/api/sync/ping', null, ({ req }) => { const b = bizByKey(req); return { ok: true, business: b.name, code: b.code }; });

  function applyRow(b, c) {
    const spec = SPEC[c.t];
    const vals = {};
    for (const col of cols(c.t)) {
      if (!(col in c.row)) continue;
      let v = c.row[col];
      if (col === 'business_id') v = b;
      else if (spec[col] && v != null) { const target = typeof spec[col] === 'function' ? spec[col](c.row) : spec[col]; v = getMap(b, target, v) ?? null; }
      vals[col] = v;
    }
    const keys = Object.keys(vals);
    const existing = getMap(b, c.t, c.id);
    if (existing) {
      const r = db.prepare(`UPDATE ${c.t} SET ${keys.map((k) => k + '=?').join(',')} WHERE id=? AND business_id=?`).run(...keys.map((k) => vals[k]), existing, b);
      if (r.changes) return;
    }
    const id = db.prepare(`INSERT INTO ${c.t} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => vals[k])).lastInsertRowid;
    db.prepare('INSERT OR REPLACE INTO sync_map (business_id,t,local_id,cloud_id) VALUES (?,?,?,?)').run(b, c.t, c.id, id);
  }
  route('POST', '/api/sync/push', null, ({ req, body }) => {
    const biz = bizByKey(req);
    const b = biz.id;
    const changes = Array.isArray(body.changes) ? body.changes : fail(400, "O'zgarishlar yo'q");
    let applied = 0, errors = 0;
    db.exec('BEGIN');
    try {
      if (body.reset) {
        for (const t of [...TABLES].reverse()) db.prepare(`DELETE FROM ${t} WHERE business_id=?`).run(b);
        db.prepare('DELETE FROM sync_map WHERE business_id=?').run(b);
        db.prepare('DELETE FROM sessions WHERE business_id=?').run(b);
      }
      for (const c of changes) {
        if (!SPEC[c.t] || !Number.isInteger(c.id)) { errors++; continue; }
        try {
          if (c.op === 'd') {
            const m = getMap(b, c.t, c.id);
            if (m) { db.prepare(`DELETE FROM ${c.t} WHERE id=? AND business_id=?`).run(m, b); db.prepare('DELETE FROM sync_map WHERE business_id=? AND t=? AND local_id=?').run(b, c.t, c.id); }
          } else if (c.row && typeof c.row === 'object') {
            if (c.t === 'users' && c.row.pin_hash) { // PIN boshqa xodimga o'tgan bo'lsa — eskisini bo'shatamiz
              const mine = getMap(b, 'users', c.id);
              db.prepare("UPDATE users SET pin_hash='boʻsh-' || id WHERE business_id=? AND pin_hash=? AND id IS NOT ?").run(b, c.row.pin_hash, mine ?? null);
            }
            applyRow(b, c);
          } else { errors++; continue; }
          applied++;
        } catch (e) { errors++; console.error(`Sinxron qabul: ${c.t}#${c.id}:`, e.message); }
      }
      db.prepare('UPDATE businesses SET mirror=1, last_sync_at=? WHERE id=?').run(now(), b);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    return { ok: true, applied, errors };
  });

  // Ega kabineti: filial uchun ulash kaliti (faqat bir marta ko'rsatiladi)
  route('POST', '/api/owner/branches/:id/sync-key', null, ({ req, p }) => {
    const o = tenant.ownerAuth(req); const b = tenant.ownBiz(o, p.id);
    const key = newKey();
    db.prepare('UPDATE businesses SET sync_key_hash=? WHERE id=?').run(keyHash(key), b.id);
    return { key };
  });
  // Bulutdagi nusxani "lokaldan ajratish" (bulutning o'zida ishlashga qaytish)
  route('POST', '/api/owner/branches/:id/unmirror', null, ({ req, p }) => {
    const o = tenant.ownerAuth(req); const b = tenant.ownBiz(o, p.id);
    db.prepare('UPDATE businesses SET mirror=0, sync_key_hash=NULL WHERE id=?').run(b.id);
    return { ok: true };
  });

  return { installTriggers, enqueueSnapshot, tick, cloudCall, bizByKey, addTickHook: (fn) => tickHooks.push(fn), keyHash };
};
