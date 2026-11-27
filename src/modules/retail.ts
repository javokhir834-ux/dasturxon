// 9-etap: dorixona va do'konlar.
// - Dorixona: faqat retseptsiz dori ilovada; platforma litsenziyani tasdiqlaydi va dorixona toifasini umuman yoqadi (yurist xulosasidan keyin).
// - Do'kon: og'irlik bilan sotiladigan mahsulot (kg), shtrix-kod, "Tez sotuv" (stolsiz kassa), buyurtmani o'zgartirish (almashtirish/olib tashlash).
// - Olib ketish (pickup) rejimi va mahsulot topilmasa nima qilish (substitution) — delivery.ts bilan birga.
import type { Ctx } from '../core/context.ts';

export const fmtKg = (g: number) => `${+(g / 1000).toFixed(3)} kg`;
/** Og'irlik bo'yicha narx: kg narxi × gramm */
export const kgPrice = (pricePerKg: number, g: number) => Math.round((pricePerKg * g) / 1000);

export default function retail(ctx: Ctx) {
  const { db, route, ROLES, int, str, fail, now, audit, broadcast, tenant, sync, z, parse } = ctx;
  const addCol = (t: string, c: string) => { try { db.exec(`ALTER TABLE ${t} ADD COLUMN ${c}`); } catch { /* bor */ } };
  ['rx INTEGER DEFAULT 0', "sold_by TEXT DEFAULT 'dona'", 'step_g INTEGER DEFAULT 100', "barcode TEXT DEFAULT ''"].forEach((c) => addCol('products', c));
  ['pickup INTEGER DEFAULT 1', "license_no TEXT DEFAULT ''", "license_until TEXT DEFAULT ''"].forEach((c) => addCol('delivery_settings', c));
  ["mode TEXT DEFAULT 'delivery'", "substitution TEXT DEFAULT ''", 'refund_amount INTEGER DEFAULT 0', "changes TEXT DEFAULT ''"].forEach((c) => addCol('delivery_orders', c));
  // Litsenziya tasdig'i bulutda (platforma) saqlanadi — lokal sinxron uni ustidan yozmasligi uchun alohida jadval
  db.exec(`CREATE TABLE IF NOT EXISTS pharmacy_licenses (business_id INTEGER PRIMARY KEY, verified INTEGER DEFAULT 0, note TEXT DEFAULT '', verified_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(business_id, barcode);`);
  sync.installTriggers();

  const dlv = ctx.dlv;
  const today = () => new Date().toISOString().slice(0, 10);
  /** Dorixona ilovada ko'rinadimi: toifa yoqilgan + litsenziya tasdiqlangan + muddati o'tmagan */
  function pharmacyStatus(b: number) {
    const s = dlv.settingsOf(b);
    if (s.place_type !== 'dorixona') return { ok: true };
    const lic = db.prepare('SELECT * FROM pharmacy_licenses WHERE business_id=?').get(b);
    if (tenant.setting('pharmacy_enabled') !== '1') return { ok: false, reason: 'Dorixonalar platformada hali yoqilmagan' };
    if (!s.license_no || !s.license_until) return { ok: false, reason: 'Litsenziya raqami va muddati kiritilmagan' };
    if (s.license_until < today()) return { ok: false, reason: 'Litsenziya muddati tugagan' };
    if (!lic?.verified) return { ok: false, reason: 'Litsenziya platforma tomonidan tekshirilmoqda' };
    return { ok: true };
  }
  dlv.ext.placeAllowed = (b: number) => pharmacyStatus(b).ok;
  dlv.ext.pharmacyStatus = pharmacyStatus;

  // ---------- Platforma: dorixonalar ----------
  route('GET', '/api/platform/pharmacies', null, ({ req }) => {
    tenant.platAuth(req);
    return db.prepare("SELECT b.id, b.name, b.code, s.license_no, s.license_until, s.enabled, l.verified, l.note, l.verified_at FROM businesses b JOIN delivery_settings s ON s.business_id=b.id LEFT JOIN pharmacy_licenses l ON l.business_id=b.id WHERE s.place_type='dorixona' ORDER BY COALESCE(l.verified,0), b.id")
      .all().map((r) => ({ ...r, verified: !!r.verified, visible: pharmacyStatus(r.id).ok, reason: pharmacyStatus(r.id).reason || '' }));
  });
  route('POST', '/api/platform/pharmacies/:id', null, ({ req, p, body }) => {
    tenant.platAuth(req);
    const b = int(p.id, 'id', { min: 1 });
    if (dlv.settingsOf(b).place_type !== 'dorixona') fail(404, 'Dorixona topilmadi');
    const verified = body.verified ? 1 : 0;
    db.prepare('INSERT INTO pharmacy_licenses (business_id,verified,note,verified_at) VALUES (?,?,?,?) ON CONFLICT(business_id) DO UPDATE SET verified=excluded.verified, note=excluded.note, verified_at=excluded.verified_at')
      .run(b, verified, str(body.note, 'Izoh', { required: false, max: 300 }), now());
    audit({ business_id: b, id: null }, verified ? 'pharmacy_verified' : 'pharmacy_unverified', 'business', b, { note: body.note || '' });
    return { ok: true, ...pharmacyStatus(b) };
  });

  // ---------- Tez sotuv (stolsiz kassa: do'kon, dorixona, fastfud) ----------
  const SaleBody = z.object({
    items: z.array(z.object({ product_id: z.coerce.number().int().positive(), qty: z.coerce.number().int().min(1).max(999).optional(), weight_g: z.coerce.number().int().min(1).max(100000).optional() })).min(1).max(100),
    payments: z.array(z.object({ method: z.enum(['naqd', 'karta', 'click', 'payme']), amount: z.coerce.number().int().min(1) })).min(1).max(4),
    rx_checked: z.boolean().optional(),
    customer_id: z.coerce.number().int().positive().optional(),
  });
  route('POST', '/api/counter/sale', ROLES.CASH, async ({ user, body }) => {
    const b = user.business_id;
    const v = parse(SaleBody, body);
    const shift = ctx.needShift(b);
    const lines = v.items.map((x) => {
      const pr = db.prepare('SELECT * FROM products WHERE id=? AND business_id=? AND active=1').get(x.product_id, b) || fail(404, 'Mahsulot topilmadi');
      if (pr.in_stop) fail(409, `"${pr.name}" stop-listda`);
      if (pr.rx && !v.rx_checked) fail(409, `"${pr.name}" — retsept bilan beriladi. Retseptni tekshirib, belgilang`);
      if (pr.sold_by === 'kg') {
        const g = x.weight_g || fail(400, `"${pr.name}" og'irligini kiriting`);
        return { pr, name: `${pr.name} — ${fmtKg(g)}`, price: kgPrice(pr.price, g), qty: 1, comment: `${g} g` };
      }
      return { pr, name: pr.name, price: pr.price, qty: x.qty || 1, comment: '' };
    });
    const total = lines.reduce((t, l) => t + l.price * l.qty, 0);
    const paid = v.payments.reduce((t, x) => t + x.amount, 0);
    const cash = v.payments.filter((x) => x.method === 'naqd').reduce((t, x) => t + x.amount, 0);
    if (paid < total) fail(400, `To'lov yetmaydi: ${total - paid} so'm`);
    const change = paid - total;
    if (change > cash) fail(400, "Qaytim faqat naqddan beriladi — summalarni tekshiring");
    const t = now();
    const number = db.prepare('SELECT COALESCE(MAX(number),0)+1 n FROM orders WHERE shift_id=?').get(shift.id).n;
    const customer = v.customer_id && db.prepare('SELECT id FROM customers WHERE id=? AND business_id=?').get(v.customer_id, b) ? v.customer_id : null;
    const oid = db.prepare(`INSERT INTO orders (business_id,shift_id,number,table_id,waiter_id,guests,service_percent,created_at,customer_id,type)
      VALUES (?,?,?,NULL,?,1,0,?,?,'counter')`).run(b, shift.id, number, user.id, t, customer).lastInsertRowid;
    for (const l of lines) db.prepare(`INSERT INTO order_items (business_id,order_id,product_id,workshop_id,name,price,qty,comment,status,created_by,created_at,sent_at)
      VALUES (?,?,?,NULL,?,?,?,?,'served',?,?,?)`).run(b, oid, l.pr.id, l.name, l.price, l.qty, l.comment, user.id, t, t);
    const rx = lines.filter((l) => l.pr.rx).map((l) => l.pr.name);
    if (rx.length) audit(user, 'rx_sale', 'order', oid, { products: rx });
    const res = await ctx.closeOrder(ctx.loadOrder(oid, b), v.payments, user, shift, change);
    broadcast(b, 'orders', { id: oid });
    return { order: ctx.loadOrder(oid, b), change, fiscal: res?.fiscal ?? null };
  });

  // ---------- Buyurtmani o'zgartirish (do'kon/dorixona: mahsulot yo'q, og'irlik boshqacha, almashtirish) ----------
  const AdjustBody = z.object({
    items: z.array(z.object({
      i: z.coerce.number().int().min(0), remove: z.boolean().optional(), qty: z.coerce.number().int().min(1).max(50).optional(),
      weight_g: z.coerce.number().int().min(1).max(100000).optional(), replace_product_id: z.coerce.number().int().positive().optional(),
    })).min(1).max(50),
  });
  route('POST', '/api/delivery/orders/:id/adjust', ROLES.CASH, ({ user, p, body }) => {
    const b = user.business_id;
    const o = dlv.getRow(int(p.id, 'id', { min: 1 }));
    if (!o || o.business_id !== b) fail(404, 'Buyurtma topilmadi');
    if (o.status !== 'new') fail(409, "Faqat qabul qilinmagan buyurtmani o'zgartirish mumkin");
    if (dlv.isReplica(b)) fail(409, "Lokal serverli restoranda o'zgartirish hozircha mumkin emas — mijozga qo'ng'iroq qiling");
    const v = parse(AdjustBody, body);
    const items = o.items.map((x) => ({ ...x }));
    const log: string[] = [];
    for (const ch of v.items) {
      const it = items[ch.i] || fail(400, "Pozitsiya topilmadi");
      if (ch.remove) { it._remove = true; log.push(`${it.name} — olib tashlandi`); continue; }
      if (ch.replace_product_id) {
        const pr = db.prepare('SELECT * FROM products WHERE id=? AND business_id=? AND active=1').get(ch.replace_product_id, b) || fail(404, 'Almashtiriladigan mahsulot topilmadi');
        if (pr.rx) fail(409, "Retseptli dori bilan almashtirib bo'lmaydi");
        const g = pr.sold_by === 'kg' ? (ch.weight_g || it.weight_g || pr.step_g || 1000) : null;
        log.push(`${it.name} → ${g ? `${pr.name} — ${fmtKg(g)}` : pr.name}`);
        Object.assign(it, { product_id: pr.id, name: g ? `${pr.name} — ${fmtKg(g)}` : pr.name, price: g ? kgPrice(pr.price, g) : pr.price, weight_g: g, qty: g ? 1 : (ch.qty || it.qty), mod_price: 0, modifiers: [], deal_id: undefined, non_returnable: pr.non_returnable });
        continue;
      }
      if (ch.weight_g && it.weight_g) {
        const pr = db.prepare('SELECT name, price FROM products WHERE id=?').get(it.product_id);
        log.push(`${pr.name}: ${fmtKg(it.weight_g)} → ${fmtKg(ch.weight_g)}`);
        Object.assign(it, { weight_g: ch.weight_g, name: `${pr.name} — ${fmtKg(ch.weight_g)}`, price: kgPrice(pr.price, ch.weight_g) });
      }
      if (ch.qty && !it.weight_g && ch.qty !== it.qty) { log.push(`${it.name}: ${it.qty} → ${ch.qty} ta`); it.qty = ch.qty; }
    }
    const left = items.filter((x) => !x._remove);
    if (!left.length) fail(409, "Hamma mahsulot olib tashlanmoqda — buyurtmani rad eting");
    const subtotal = left.reduce((t, i) => t + (i.price + (i.mod_price || 0)) * i.qty, 0);
    const total = subtotal + o.delivery_fee + (o.debt_amount || 0);
    const paid = o.payment_status === 'paid' ? o.paid_amount || 0 : 0;
    if (paid && total > paid) fail(409, `Yangi summa (${total}) to'langandan (${paid}) ko'p. Arzonroq almashtiring yoki mijozga qo'ng'iroq qiling`);
    const refund = paid > total ? paid - total : 0;
    const changes = [...(o.changes ? JSON.parse(o.changes) : []), ...log];
    db.prepare('UPDATE delivery_orders SET items=?, subtotal=?, total=?, prepay_amount=MIN(prepay_amount, ?), commission=?, refund_amount=?, changes=?, updated_at=? WHERE id=?')
      .run(JSON.stringify(left), subtotal, total, total, Math.round(subtotal * (o.commission_percent || 0) / 100), refund, JSON.stringify(changes), now(), o.id);
    audit(user, 'delivery_adjust', 'delivery_orders', o.id, { log, subtotal, refund });
    broadcast(b, 'delivery', { id: o.id });
    if (o.app_user_id) ctx.push?.toCustomer(o.app_user_id, { title: `Buyurtma #${o.id} o'zgardi`, body: log.join('; ').slice(0, 150) + (refund ? ` · ${refund} so'm qaytariladi` : ''), data: { type: 'order', id: o.id } });
    return dlv.getRow(o.id);
  });

  return { pharmacyStatus, fmtKg, kgPrice };
}
