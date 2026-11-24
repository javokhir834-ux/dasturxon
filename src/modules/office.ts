// 2-etap: Ofis — ombor, texnologik kartalar, kirim, chiqim, inventarizatsiya, ta'minotchilar, tannarx, hisobotlar.
// src/modules/index.ts orqali ulanadi — marshrutlarni ro'yxatdan o'tkazadi va sotuv hooklarini qaytaradi.

import type { Ctx } from '../core/context.ts';
export default function office(ctx: Ctx) {
  const { db, route, ROLES, int, str, fail, audit, broadcast, now, currentShift } = ctx;

  // ---------- Sxema ----------
  db.exec(`
  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL, unit TEXT DEFAULT 'kg',
    cost INTEGER DEFAULT 0, min_qty REAL DEFAULT 0, is_semi INTEGER DEFAULT 0, active INTEGER DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS recipe_items (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, owner_type TEXT NOT NULL CHECK(owner_type IN ('product','semi')),
    owner_id INTEGER NOT NULL, ingredient_id INTEGER NOT NULL, qty REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stock_moves (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, ingredient_id INTEGER NOT NULL, qty REAL NOT NULL, cost INTEGER DEFAULT 0,
    type TEXT NOT NULL CHECK(type IN ('income','sale','writeoff','inventory','produce_in','produce_out')),
    ref_type TEXT, ref_id INTEGER, note TEXT, user_id INTEGER, at TEXT
  );
  CREATE TABLE IF NOT EXISTS suppliers (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, name TEXT NOT NULL, phone TEXT DEFAULT '', note TEXT DEFAULT '', active INTEGER DEFAULT 1);
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, supplier_id INTEGER, number TEXT, total INTEGER DEFAULT 0, note TEXT, user_id INTEGER, at TEXT
  );
  CREATE TABLE IF NOT EXISTS invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL, ingredient_id INTEGER NOT NULL, qty REAL NOT NULL, price INTEGER NOT NULL, sum INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS supplier_payments (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, supplier_id INTEGER NOT NULL, amount INTEGER NOT NULL, method TEXT, from_cash INTEGER DEFAULT 0, note TEXT, user_id INTEGER, at TEXT);
  CREATE TABLE IF NOT EXISTS inventories (id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, note TEXT, diff_sum INTEGER DEFAULT 0, user_id INTEGER, at TEXT);
  CREATE TABLE IF NOT EXISTS inventory_items (id INTEGER PRIMARY KEY, inventory_id INTEGER NOT NULL, ingredient_id INTEGER NOT NULL, expected REAL, actual REAL, diff REAL, cost INTEGER);
  CREATE INDEX IF NOT EXISTS idx_moves_ing ON stock_moves(business_id, ingredient_id);
  CREATE INDEX IF NOT EXISTS idx_recipe_owner ON recipe_items(owner_type, owner_id);
  `);
  try { db.exec('ALTER TABLE order_items ADD COLUMN cost INTEGER DEFAULT 0'); } catch { /* allaqachon bor */ }

  const UNITS = ['kg', 'l', 'dona'];
  const r3 = (x) => Math.round(x * 1000) / 1000;
  const num = (v, name, { min = -1e9, max = 1e9 } = {}) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) fail(400, `${name} noto'g'ri`);
    return r3(n);
  };

  const stockOf = (b, id) => db.prepare('SELECT COALESCE(SUM(qty),0) q FROM stock_moves WHERE business_id=? AND ingredient_id=?').get(b, id).q;
  const ing = (b, id) => db.prepare('SELECT * FROM ingredients WHERE id=? AND business_id=?').get(id, b) || fail(404, 'Masalliq topilmadi');
  const move = (b, ingredientId, qty, cost, type, refType, refId, note, userId, at = now()) =>
    db.prepare('INSERT INTO stock_moves (business_id,ingredient_id,qty,cost,type,ref_type,ref_id,note,user_id,at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(b, ingredientId, r3(qty), cost, type, refType, refId, note || null, userId || null, at);

  // O'rtacha tannarxni yangilash (kirim yoki ishlab chiqarishda)
  function addWithCost(b, i, qty, price) {
    const have = stockOf(b, i.id);
    const avg = have > 0 ? Math.round((have * i.cost + qty * price) / (have + qty)) : price;
    db.prepare('UPDATE ingredients SET cost=? WHERE id=?').run(avg, i.id);
  }

  const recipe = (b, type, id) => db.prepare(`SELECT r.ingredient_id, r.qty, i.name, i.unit, i.cost, i.is_semi FROM recipe_items r
    JOIN ingredients i ON i.id=r.ingredient_id WHERE r.business_id=? AND r.owner_type=? AND r.owner_id=? ORDER BY r.id`).all(b, type, id);
  const recipeCost = (lines) => Math.round(lines.reduce((s, l) => s + l.qty * l.cost, 0));

  // ---------- Sotuv hooklari (server.js chaqiradi) ----------
  function writeOffSale(order, user) {
    const b = order.business_id;
    for (const it of order.items.filter((i) => i.status !== 'cancelled' && i.product_id)) {
      const lines = recipe(b, 'product', it.product_id);
      if (!lines.length) continue;
      lines.forEach((l) => move(b, l.ingredient_id, -l.qty * it.qty, l.cost, 'sale', 'order', order.id, `#${order.number} ${it.name}`, user.id));
      db.prepare('UPDATE order_items SET cost=? WHERE id=?').run(recipeCost(lines), it.id);
    }
    broadcast(b, 'stock');
  }
  function writeOffCancelled(item, order, reason, user) {
    const b = item.business_id;
    const lines = item.product_id ? recipe(b, 'product', item.product_id) : [];
    lines.forEach((l) => move(b, l.ingredient_id, -l.qty * item.qty, l.cost, 'writeoff', 'order_item', item.id, `Bekor: #${order.number} ${item.name} — ${reason}`, user.id));
    if (lines.length) broadcast(b, 'stock');
    return lines.length;
  }

  // ---------- Namuna ma'lumotlar ----------
  (function seed() {
    const B = 1;
    if (db.prepare('SELECT COUNT(*) c FROM ingredients').get().c) return;
    const P = (n) => db.prepare('SELECT id FROM products WHERE business_id=? AND name=?').get(B, n)?.id;
    if (!P('Osh (1 porsiya)')) return;
    const ins = db.prepare('INSERT INTO ingredients (business_id,name,unit,cost,min_qty,is_semi) VALUES (?,?,?,?,?,?)');
    const I: Record<string, any> = {};
    [["Mol go'shti", 'kg', 110000, 5], ["Qo'y go'shti", 'kg', 120000, 3], ['Tovuq', 'kg', 38000, 3], ['Jigar', 'kg', 60000, 1],
      ['Guruch (devzira)', 'kg', 28000, 10], ['Sabzi', 'kg', 6000, 10], ['Piyoz', 'kg', 5000, 10], ["O'simlik yog'i", 'l', 22000, 5],
      ['Un', 'kg', 7000, 20], ['Kartoshka', 'kg', 5000, 10], ['Pomidor', 'kg', 15000, 5], ['Bodring', 'kg', 12000, 3],
      ["Ko'k choy", 'kg', 90000, 0.5], ['Qora choy', 'kg', 80000, 0.5], ['Kola 0.5', 'dona', 5500, 24], ['Mineral suv', 'dona', 3000, 24],
      ['Quruq meva', 'kg', 40000, 1], ['Mayonez', 'kg', 25000, 1]]
      .forEach(([n, u, c, m]) => { I[n] = ins.run(B, n, u, c, m, 0).lastInsertRowid; });
    I['Xamir'] = ins.run(B, 'Xamir', 'kg', 0, 3, 1).lastInsertRowid;
    const rec = db.prepare('INSERT INTO recipe_items (business_id,owner_type,owner_id,ingredient_id,qty) VALUES (?,?,?,?,?)');
    rec.run(B, 'semi', I['Xamir'], I['Un'], 0.65); // 1 kg xamir = 0.65 kg un (+suv)
    const R = {
      'Osh (1 porsiya)': [['Guruch (devzira)', 0.12], ["Mol go'shti", 0.07], ['Sabzi', 0.1], ['Piyoz', 0.03], ["O'simlik yog'i", 0.03]],
      "Lag'mon": [['Xamir', 0.15], ["Mol go'shti", 0.06], ['Piyoz', 0.03], ['Pomidor', 0.05], ['Kartoshka', 0.05], ["O'simlik yog'i", 0.02]],
      'Manti (5 dona)': [['Xamir', 0.12], ["Qo'y go'shti", 0.12], ['Piyoz', 0.08]],
      'Qozon kabob': [["Qo'y go'shti", 0.25], ['Kartoshka', 0.25], ["O'simlik yog'i", 0.05], ['Piyoz', 0.05]],
      "Sho'rva": [["Qo'y go'shti", 0.1], ['Kartoshka', 0.1], ['Sabzi', 0.05], ['Piyoz', 0.03], ['Pomidor', 0.03]],
      "Mol go'shti shashlik": [["Mol go'shti", 0.1], ['Piyoz', 0.02]],
      "Qo'y go'shti shashlik": [["Qo'y go'shti", 0.1], ['Piyoz', 0.02]],
      'Jigar shashlik': [['Jigar', 0.1]], 'Tovuq shashlik': [['Tovuq', 0.12]],
      'Achchiq-chuchuk': [['Pomidor', 0.2], ['Piyoz', 0.05]],
      'Toshkent salati': [["Mol go'shti", 0.06], ['Bodring', 0.06], ['Mayonez', 0.04]],
      'Tandir non': [['Un', 0.25]], 'Somsa': [['Xamir', 0.08], ["Qo'y go'shti", 0.04], ['Piyoz', 0.03]], 'Patir': [['Un', 0.3]],
      "Ko'k choy (choynak)": [["Ko'k choy", 0.006]], 'Qora choy (choynak)': [['Qora choy', 0.006]],
      'Kola 0.5': [['Kola 0.5', 1]], 'Mineral suv': [['Mineral suv', 1]], 'Kompot (1 l)': [['Quruq meva', 0.08]],
    };
    for (const [pn, lines] of Object.entries(R)) { const pid = P(pn); if (pid) lines.forEach(([n, q]) => rec.run(B, 'product', pid, I[n], q)); }
    const sup = db.prepare('INSERT INTO suppliers (business_id,name,phone) VALUES (?,?,?)');
    const s1 = sup.run(B, "Dehqon bozori (ulgurji)", '').lastInsertRowid;
    sup.run(B, "Go'sht ta'minotchisi", '+998 90 000 00 00');
    const at = now();
    const inv = db.prepare("INSERT INTO invoices (business_id,supplier_id,number,total,note,at) VALUES (?,?,?,?,?,?)").run(B, s1, 'BOSHLANG\'ICH', 0, "Boshlang'ich qoldiq", at).lastInsertRowid;
    let total = 0;
    const start = { "Mol go'shti": 20, "Qo'y go'shti": 15, Tovuq: 10, Jigar: 5, 'Guruch (devzira)': 50, Sabzi: 40, Piyoz: 40, "O'simlik yog'i": 20, Un: 60,
      Kartoshka: 30, Pomidor: 15, Bodring: 8, "Ko'k choy": 2, 'Qora choy': 2, 'Kola 0.5': 48, 'Mineral suv': 48, 'Quruq meva': 3, Mayonez: 3 };
    for (const [n, q] of Object.entries(start)) {
      const c = db.prepare('SELECT cost FROM ingredients WHERE id=?').get(I[n]).cost;
      db.prepare('INSERT INTO invoice_items (invoice_id,ingredient_id,qty,price,sum) VALUES (?,?,?,?,?)').run(inv, I[n], q, c, Math.round(q * c));
      move(B, I[n], q, c, 'income', 'invoice', inv, "Boshlang'ich qoldiq", null, at);
      total += Math.round(q * c);
    }
    db.prepare('UPDATE invoices SET total=? WHERE id=?').run(total, inv);
    db.prepare("INSERT INTO supplier_payments (business_id,supplier_id,amount,method,note,at) VALUES (?,?,?,?,?,?)").run(B, s1, total, 'naqd', "Boshlang'ich qoldiq", at);
    // Xamir: 10 kg tayyorlab qo'yamiz
    const unCost = db.prepare('SELECT cost FROM ingredients WHERE id=?').get(I['Un']).cost;
    move(B, I['Un'], -6.5, unCost, 'produce_out', 'produce', null, 'Xamir tayyorlash', null, at);
    move(B, I['Xamir'], 10, Math.round(0.65 * unCost), 'produce_in', 'produce', null, 'Xamir tayyorlash', null, at);
    db.prepare('UPDATE ingredients SET cost=? WHERE id=?').run(Math.round(0.65 * unCost), I['Xamir']);
  })();

  // ---------- Qoldiqlar ----------
  function stockList(b, withInactive) {
    return db.prepare(`SELECT i.*, COALESCE((SELECT SUM(qty) FROM stock_moves m WHERE m.business_id=i.business_id AND m.ingredient_id=i.id),0) qty
      FROM ingredients i WHERE i.business_id=? ${withInactive ? '' : 'AND i.active=1'} ORDER BY i.active DESC, i.is_semi, i.name`).all(b)
      .map((r) => ({ ...r, qty: r3(r.qty), value: Math.round(Math.max(0, r.qty) * r.cost), low: r.qty < r.min_qty }));
  }
  route('GET', '/api/stock', ROLES.STOCK, ({ user, url }) => stockList(user.business_id, url.searchParams.get('all') === '1'));

  route('GET', '/api/stock/moves', ROLES.STOCK, ({ user, url }) => {
    const iid = url.searchParams.get('ingredient_id'); const type = url.searchParams.get('type');
    const args: any[] = [user.business_id]; let where = '';
    if (iid) { where += ' AND m.ingredient_id=?'; args.push(Number(iid)); }
    if (type) { where += ' AND m.type=?'; args.push(type); }
    return db.prepare(`SELECT m.*, i.name, i.unit, u.name user_name FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id
      LEFT JOIN users u ON u.id=m.user_id WHERE m.business_id=? ${where} ORDER BY m.id DESC LIMIT 400`).all(...args);
  });

  // Masalliq yaratish/tahrirlash
  route('POST', '/api/stock/ingredients', ROLES.STOCK, ({ user, body }) => {
    const b = user.business_id;
    const id = body.id ? int(body.id, 'id', { min: 1 }) : null;
    const old = id ? ing(b, id) : null;
    const v : Record<string, any> = {
      name: body.name !== undefined ? str(body.name, 'Nomi') : old?.name ?? fail(400, 'Nomi kiritilmagan'),
      unit: body.unit !== undefined ? (UNITS.includes(body.unit) ? body.unit : fail(400, "O'lchov birligi noto'g'ri")) : old?.unit ?? 'kg',
      cost: body.cost !== undefined ? int(body.cost, 'Narx') : old?.cost ?? 0,
      min_qty: body.min_qty !== undefined ? num(body.min_qty, 'Minimal qoldiq', { min: 0 }) : old?.min_qty ?? 0,
      is_semi: body.is_semi !== undefined ? (body.is_semi ? 1 : 0) : old?.is_semi ?? 0,
      active: body.active !== undefined ? (body.active ? 1 : 0) : old?.active ?? 1,
    };
    let rid = id;
    if (old) db.prepare('UPDATE ingredients SET name=?,unit=?,cost=?,min_qty=?,is_semi=?,active=? WHERE id=?').run(v.name, v.unit, v.cost, v.min_qty, v.is_semi, v.active, id);
    else rid = db.prepare('INSERT INTO ingredients (business_id,name,unit,cost,min_qty,is_semi,active) VALUES (?,?,?,?,?,?,?)').run(b, v.name, v.unit, v.cost, v.min_qty, v.is_semi, v.active).lastInsertRowid;
    audit(user, old ? 'update' : 'create', 'ingredients', rid, v);
    broadcast(b, 'stock');
    return ing(b, rid);
  });

  // ---------- Texnologik kartalar ----------
  route('GET', '/api/recipes/:type/:id', ROLES.STOCK, ({ user, p }) => {
    if (!['product', 'semi'].includes(p.type)) fail(404, "Noma'lum");
    const lines = recipe(user.business_id, p.type, int(p.id, 'id'));
    return { lines, cost: recipeCost(lines) };
  });
  route('PUT', '/api/recipes/:type/:id', ROLES.STOCK, ({ user, p, body }) => {
    const b = user.business_id;
    const type = ['product', 'semi'].includes(p.type) ? p.type : fail(404, "Noma'lum");
    const oid = int(p.id, 'id');
    const owner = type === 'product' ? db.prepare('SELECT id,name FROM products WHERE id=? AND business_id=?').get(oid, b) : db.prepare('SELECT id,name FROM ingredients WHERE id=? AND business_id=? AND is_semi=1').get(oid, b);
    if (!owner) fail(404, 'Topilmadi');
    const lines = (Array.isArray(body.lines) ? body.lines : []).map((l) => ({ ingredient_id: int(l.ingredient_id, 'Masalliq', { min: 1 }), qty: num(l.qty, 'Miqdor', { min: 0.0001 }) }));
    lines.forEach((l) => { ing(b, l.ingredient_id); if (type === 'semi' && l.ingredient_id === oid) fail(400, "Yarim tayyor mahsulot o'zidan iborat bo'lolmaydi"); });
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM recipe_items WHERE business_id=? AND owner_type=? AND owner_id=?').run(b, type, oid);
      const ins = db.prepare('INSERT INTO recipe_items (business_id,owner_type,owner_id,ingredient_id,qty) VALUES (?,?,?,?,?)');
      lines.forEach((l) => ins.run(b, type, oid, l.ingredient_id, l.qty));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user, 'recipe_save', type, oid, { name: owner.name, lines: lines.length });
    broadcast(b, 'stock');
    const saved = recipe(b, type, oid);
    return { lines: saved, cost: recipeCost(saved) };
  });

  // Taomlar tannarxi va marjasi
  route('GET', '/api/costs', ROLES.STOCK, ({ user }) => {
    const b = user.business_id;
    return db.prepare('SELECT id,name,price,category_id FROM products WHERE business_id=? AND active=1 ORDER BY category_id, sort, id').all(b).map((pr) => {
      const lines = recipe(b, 'product', pr.id);
      const cost = recipeCost(lines);
      return { ...pr, lines: lines.length, cost, margin: pr.price ? Math.round((pr.price - cost) / pr.price * 100) : 0 };
    });
  });

  // ---------- Ta'minotchilar ----------
  route('GET', '/api/suppliers', ROLES.STOCK, ({ user }) => db.prepare(`SELECT s.*,
      COALESCE((SELECT SUM(total) FROM invoices i WHERE i.supplier_id=s.id),0) bought,
      COALESCE((SELECT SUM(amount) FROM supplier_payments p WHERE p.supplier_id=s.id),0) paid
    FROM suppliers s WHERE s.business_id=? ORDER BY s.active DESC, s.name`).all(user.business_id).map((s) => ({ ...s, debt: s.bought - s.paid })));
  route('POST', '/api/suppliers', ROLES.STOCK, ({ user, body }) => {
    const b = user.business_id;
    const id = body.id ? int(body.id, 'id', { min: 1 }) : null;
    const old = id ? db.prepare('SELECT * FROM suppliers WHERE id=? AND business_id=?').get(id, b) || fail(404, 'Topilmadi') : null;
    const v : Record<string, any> = {
      name: body.name !== undefined ? str(body.name, 'Nomi') : old?.name ?? fail(400, 'Nomi kiritilmagan'),
      phone: body.phone !== undefined ? str(body.phone, 'Telefon', { required: false }) : old?.phone ?? '',
      note: body.note !== undefined ? str(body.note, 'Izoh', { required: false }) : old?.note ?? '',
      active: body.active !== undefined ? (body.active ? 1 : 0) : old?.active ?? 1,
    };
    let rid = id;
    if (old) db.prepare('UPDATE suppliers SET name=?,phone=?,note=?,active=? WHERE id=?').run(v.name, v.phone, v.note, v.active, id);
    else rid = db.prepare('INSERT INTO suppliers (business_id,name,phone,note,active) VALUES (?,?,?,?,?)').run(b, v.name, v.phone, v.note, v.active).lastInsertRowid;
    audit(user, old ? 'update' : 'create', 'suppliers', rid, v);
    return { id: rid, ...v };
  });
  route('POST', '/api/suppliers/:id/pay', ROLES.STOCK, ({ user, p, body }) => {
    const b = user.business_id;
    const s = db.prepare('SELECT * FROM suppliers WHERE id=? AND business_id=?').get(int(p.id, 'id'), b) || fail(404, "Ta'minotchi topilmadi");
    const amount = int(body.amount, 'Summa', { min: 1 });
    const method = ['naqd', 'karta', 'otkazma'].includes(body.method) ? body.method : 'naqd';
    const fromCash = method === 'naqd' && body.from_cash ? 1 : 0;
    const at = now();
    if (fromCash) {
      const sh = currentShift(b) || fail(409, "Kassadan to'lash uchun smena ochiq bo'lishi kerak");
      db.prepare("INSERT INTO cash_moves (business_id,shift_id,type,amount,note,user_id,at) VALUES (?,?,'out',?,?,?,?)").run(b, sh.id, amount, `Ta'minotchiga: ${s.name}`, user.id, at);
      broadcast(b, 'shift');
    }
    db.prepare('INSERT INTO supplier_payments (business_id,supplier_id,amount,method,from_cash,note,user_id,at) VALUES (?,?,?,?,?,?,?,?)')
      .run(b, s.id, amount, method, fromCash, str(body.note, 'Izoh', { required: false }), user.id, at);
    audit(user, 'supplier_pay', 'suppliers', s.id, { name: s.name, amount, method, from_cash: !!fromCash });
    return { ok: true };
  });

  // ---------- Kirim (nakladnoy) ----------
  route('GET', '/api/stock/invoices', ROLES.STOCK, ({ user }) => db.prepare(`SELECT i.*, s.name supplier_name, u.name user_name,
      (SELECT COUNT(*) FROM invoice_items x WHERE x.invoice_id=i.id) lines FROM invoices i
      LEFT JOIN suppliers s ON s.id=i.supplier_id LEFT JOIN users u ON u.id=i.user_id WHERE i.business_id=? ORDER BY i.id DESC LIMIT 200`).all(user.business_id));
  route('GET', '/api/stock/invoices/:id', ROLES.STOCK, ({ user, p }) => {
    const inv = db.prepare('SELECT i.*, s.name supplier_name FROM invoices i LEFT JOIN suppliers s ON s.id=i.supplier_id WHERE i.id=? AND i.business_id=?').get(int(p.id, 'id'), user.business_id) || fail(404, 'Topilmadi');
    inv.items = db.prepare('SELECT x.*, g.name, g.unit FROM invoice_items x JOIN ingredients g ON g.id=x.ingredient_id WHERE x.invoice_id=?').all(inv.id);
    return inv;
  });
  route('POST', '/api/stock/invoices', ROLES.STOCK, ({ user, body }) => {
    const b = user.business_id;
    const supplierId = body.supplier_id ? int(body.supplier_id, "Ta'minotchi", { min: 1 }) : null;
    if (supplierId && !db.prepare('SELECT id FROM suppliers WHERE id=? AND business_id=?').get(supplierId, b)) fail(404, "Ta'minotchi topilmadi");
    const items = (Array.isArray(body.items) ? body.items : []).map((x) => ({ ingredient_id: int(x.ingredient_id, 'Masalliq', { min: 1 }), qty: num(x.qty, 'Miqdor', { min: 0.001 }), price: int(x.price, 'Narx') }));
    if (!items.length) fail(400, "Nakladnoyda pozitsiya yo'q");
    const at = now();
    db.exec('BEGIN');
    try {
      const total = items.reduce((s, x) => s + Math.round(x.qty * x.price), 0);
      const id = db.prepare('INSERT INTO invoices (business_id,supplier_id,number,total,note,user_id,at) VALUES (?,?,?,?,?,?,?)')
        .run(b, supplierId, str(body.number, 'Raqam', { required: false, max: 50 }), total, str(body.note, 'Izoh', { required: false }), user.id, at).lastInsertRowid;
      for (const x of items) {
        const g = ing(b, x.ingredient_id);
        addWithCost(b, g, x.qty, x.price);
        db.prepare('INSERT INTO invoice_items (invoice_id,ingredient_id,qty,price,sum) VALUES (?,?,?,?,?)').run(id, x.ingredient_id, x.qty, x.price, Math.round(x.qty * x.price));
        move(b, x.ingredient_id, x.qty, x.price, 'income', 'invoice', id, body.number ? `Nakladnoy ${body.number}` : 'Kirim', user.id, at);
      }
      const paidNow = body.paid_now ? int(body.paid_now, "To'langan summa") : 0;
      if (paidNow && supplierId) {
        if (body.from_cash) {
          const sh = currentShift(b) || fail(409, "Kassadan to'lash uchun smena ochiq bo'lishi kerak");
          db.prepare("INSERT INTO cash_moves (business_id,shift_id,type,amount,note,user_id,at) VALUES (?,?,'out',?,?,?,?)").run(b, sh.id, paidNow, 'Nakladnoy uchun to\'lov', user.id, at);
        }
        db.prepare('INSERT INTO supplier_payments (business_id,supplier_id,amount,method,from_cash,note,user_id,at) VALUES (?,?,?,?,?,?,?,?)')
          .run(b, supplierId, paidNow, 'naqd', body.from_cash ? 1 : 0, `Nakladnoy #${id}`, user.id, at);
      }
      db.exec('COMMIT');
      audit(user, 'invoice', 'invoices', id, { total, items: items.length, paid_now: paidNow });
      broadcast(b, 'stock'); if (body.from_cash) broadcast(b, 'shift');
      return { id, total };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });

  // ---------- Hisobdan chiqarish ----------
  route('POST', '/api/stock/writeoff', ROLES.STOCK, ({ user, body }) => {
    const b = user.business_id;
    const reason = str(body.reason, 'Sababi');
    const items = (Array.isArray(body.items) ? body.items : []).map((x) => ({ ingredient_id: int(x.ingredient_id, 'Masalliq', { min: 1 }), qty: num(x.qty, 'Miqdor', { min: 0.001 }) }));
    if (!items.length) fail(400, "Pozitsiya yo'q");
    const at = now(); let sum = 0;
    db.exec('BEGIN');
    try {
      for (const x of items) { const g = ing(b, x.ingredient_id); move(b, g.id, -x.qty, g.cost, 'writeoff', 'manual', null, reason, user.id, at); sum += Math.round(x.qty * g.cost); }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    audit(user, 'writeoff', 'stock', null, { reason, items: items.length, sum });
    broadcast(b, 'stock');
    return { ok: true, sum };
  });

  // ---------- Yarim tayyor mahsulot tayyorlash ----------
  route('POST', '/api/stock/produce', ROLES.STOCK, ({ user, body }) => {
    const b = user.business_id;
    const semi = ing(b, int(body.semi_id, 'Yarim tayyor', { min: 1 }));
    if (!semi.is_semi) fail(400, "Bu yarim tayyor mahsulot emas");
    const qty = num(body.qty, 'Miqdor', { min: 0.001 });
    const lines = recipe(b, 'semi', semi.id);
    if (!lines.length) fail(409, "Bu yarim tayyor mahsulotning texnologik kartasi yo'q");
    const at = now();
    db.exec('BEGIN');
    try {
      const unitCost = recipeCost(lines);
      lines.forEach((l) => move(b, l.ingredient_id, -l.qty * qty, l.cost, 'produce_out', 'produce', semi.id, `${semi.name} tayyorlash`, user.id, at));
      addWithCost(b, semi, qty, unitCost);
      move(b, semi.id, qty, unitCost, 'produce_in', 'produce', semi.id, `${semi.name} tayyorlash`, user.id, at);
      db.exec('COMMIT');
      audit(user, 'produce', 'ingredients', semi.id, { name: semi.name, qty, cost: Math.round(unitCost * qty) });
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    broadcast(b, 'stock');
    return { ok: true };
  });

  // ---------- Inventarizatsiya ----------
  route('GET', '/api/stock/inventories', ROLES.STOCK, ({ user }) => db.prepare(`SELECT v.*, u.name user_name, (SELECT COUNT(*) FROM inventory_items x WHERE x.inventory_id=v.id) lines
    FROM inventories v LEFT JOIN users u ON u.id=v.user_id WHERE v.business_id=? ORDER BY v.id DESC LIMIT 100`).all(user.business_id));
  route('GET', '/api/stock/inventories/:id', ROLES.STOCK, ({ user, p }) => {
    const v = db.prepare('SELECT * FROM inventories WHERE id=? AND business_id=?').get(int(p.id, 'id'), user.business_id) || fail(404, 'Topilmadi');
    v.items = db.prepare('SELECT x.*, g.name, g.unit FROM inventory_items x JOIN ingredients g ON g.id=x.ingredient_id WHERE x.inventory_id=? ORDER BY g.name').all(v.id);
    return v;
  });
  route('POST', '/api/stock/inventory', ROLES.STOCK, ({ user, body }) => {
    const b = user.business_id;
    const rows = (Array.isArray(body.items) ? body.items : []).filter((x) => x.actual !== '' && x.actual != null)
      .map((x) => ({ ingredient_id: int(x.ingredient_id, 'Masalliq', { min: 1 }), actual: num(x.actual, 'Haqiqiy qoldiq', { min: 0 }) }));
    if (!rows.length) fail(400, 'Hech bir qoldiq kiritilmagan');
    const at = now();
    db.exec('BEGIN');
    try {
      const id = db.prepare('INSERT INTO inventories (business_id,note,user_id,at) VALUES (?,?,?,?)').run(b, str(body.note, 'Izoh', { required: false }), user.id, at).lastInsertRowid;
      let diffSum = 0;
      for (const r of rows) {
        const g = ing(b, r.ingredient_id);
        const expected = r3(stockOf(b, g.id));
        const diff = r3(r.actual - expected);
        db.prepare('INSERT INTO inventory_items (inventory_id,ingredient_id,expected,actual,diff,cost) VALUES (?,?,?,?,?,?)').run(id, g.id, expected, r.actual, diff, g.cost);
        if (diff !== 0) move(b, g.id, diff, g.cost, 'inventory', 'inventory', id, 'Inventarizatsiya', user.id, at);
        diffSum += Math.round(diff * g.cost);
      }
      db.prepare('UPDATE inventories SET diff_sum=? WHERE id=?').run(diffSum, id);
      db.exec('COMMIT');
      audit(user, 'inventory', 'inventories', id, { lines: rows.length, diff_sum: diffSum });
      broadcast(b, 'stock');
      return { id, diff_sum: diffSum };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  });

  // ---------- Hisobotlar ----------
  route('GET', '/api/reports/sales', ROLES.REPORTS, ({ user, url }) => {
    const b = user.business_id;
    const day = (s, end = false) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) fail(400, "Sana noto'g'ri"); return new Date(`${s}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString(); };
    const from = day(url.searchParams.get('from')), to = day(url.searchParams.get('to'), true);
    const orders = db.prepare(`SELECT o.*, u.name waiter_name FROM orders o LEFT JOIN users u ON u.id=o.waiter_id
      WHERE o.business_id=? AND o.status='closed' AND o.closed_at BETWEEN ? AND ?`).all(b, from, to);
    const items = db.prepare(`SELECT i.*, p.category_id, c.name category_name FROM order_items i JOIN orders o ON o.id=i.order_id
      LEFT JOIN products p ON p.id=i.product_id LEFT JOIN categories c ON c.id=p.category_id
      WHERE o.business_id=? AND o.status='closed' AND o.closed_at BETWEEN ? AND ? AND i.status!='cancelled'`).all(b, from, to);
    const pays = db.prepare(`SELECT p.method, SUM(p.amount) s FROM payments p JOIN orders o ON o.id=p.order_id
      WHERE o.business_id=? AND o.status='closed' AND o.closed_at BETWEEN ? AND ? GROUP BY p.method`).all(b, from, to);
    const byOrder: Record<string, any> = {};
    items.forEach((i) => (byOrder[i.order_id] ||= []).push(i));
    const days: Record<string, any> = {}, hours = Array.from({ length: 24 }, (_, h) => ({ h, revenue: 0, orders: 0 })), waiters: Record<string, any> = {}, cats: Record<string, any> = {}, prods: Record<string, any> = {};
    let revenue = 0, cost = 0, discounts = 0, service = 0, guests = 0, noRecipe = new Set();
    for (const o of orders) {
      const its = byOrder[o.id] || [];
      const sub = its.reduce((s, i) => s + (i.price + i.mod_price) * i.qty, 0);
      const disc = Math.min(sub, o.discount_amount + Math.round(sub * o.discount_percent / 100));
      const serv = Math.round((sub - disc) * o.service_percent / 100);
      const total = sub - disc + serv;
      const oc = its.reduce((s, i) => s + (i.cost || 0) * i.qty, 0);
      revenue += total; cost += oc; discounts += disc; service += serv; guests += o.guests;
      const d = new Date(o.closed_at);
      const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      (days[dk] ||= { day: dk, revenue: 0, orders: 0, cost: 0 }); days[dk].revenue += total; days[dk].orders++; days[dk].cost += oc;
      hours[d.getHours()].revenue += total; hours[d.getHours()].orders++;
      const w = (waiters[o.waiter_id] ||= { name: o.waiter_name || '—', orders: 0, revenue: 0, guests: 0 });
      w.orders++; w.revenue += total; w.guests += o.guests;
      for (const i of its) {
        const gross = (i.price + i.mod_price) * i.qty;
        const c = (cats[i.category_name || 'Boshqa'] ||= { name: i.category_name || 'Boshqa', qty: 0, revenue: 0, cost: 0 });
        c.qty += i.qty; c.revenue += gross; c.cost += (i.cost || 0) * i.qty;
        const pr = (prods[i.name] ||= { name: i.name, qty: 0, revenue: 0, cost: 0 });
        pr.qty += i.qty; pr.revenue += gross; pr.cost += (i.cost || 0) * i.qty;
        if (!i.cost) noRecipe.add(i.name);
      }
    }
    const plist = Object.values(prods).sort((a, z) => z.revenue - a.revenue);
    const grossAll = plist.reduce((s, x) => s + x.revenue, 0) || 1;
    let cum = 0;
    plist.forEach((x) => { const before = cum / grossAll; cum += x.revenue; x.abc = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C'; x.share = Math.round(x.revenue / grossAll * 1000) / 10; x.profit = x.revenue - x.cost; });
    // Davr ichidagi har bir kun (bo'sh kunlar ham)
    const dayList = [];
    for (let d = new Date(from); d <= new Date(to) && dayList.length < 400; d.setDate(d.getDate() + 1)) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dayList.push(days[k] || { day: k, revenue: 0, orders: 0, cost: 0 });
    }
    const writeoffs = db.prepare("SELECT COALESCE(SUM(-qty*cost),0) s FROM stock_moves WHERE business_id=? AND type='writeoff' AND at BETWEEN ? AND ?").get(b, from, to).s;
    const invDiff = db.prepare("SELECT COALESCE(SUM(qty*cost),0) s FROM stock_moves WHERE business_id=? AND type='inventory' AND at BETWEEN ? AND ?").get(b, from, to).s;
    return {
      from, to, revenue, orders: orders.length, avg: orders.length ? Math.round(revenue / orders.length) : 0, guests, discounts, service, cost,
      profit: revenue - service - cost, margin: revenue - service ? Math.round((revenue - service - cost) / (revenue - service) * 100) : 0,
      writeoffs: Math.round(writeoffs), inventoryDiff: Math.round(invDiff),
      byMethod: Object.fromEntries(pays.map((x) => [x.method, x.s])),
      days: dayList, hours, waiters: Object.values(waiters).sort((a, z) => z.revenue - a.revenue),
      categories: Object.values(cats).sort((a, z) => z.revenue - a.revenue), products: plist, noRecipe: [...noRecipe],
    };
  });

  return { writeOffSale, writeOffCancelled, stockList };
};
