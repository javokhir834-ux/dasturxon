// 9-etap: Kechki chegirma — kun oxirida ortgan taomni chegirma bilan sotish (isrof kamayadi, restoran pul topadi).
// Restoran: mahsulot + soni + chegirma % + qachongacha. Mijoz ilovasida "🌙 Kechki chegirmalar"; faqat oldindan to'lov.
// Sotilgan soni alohida saqlanmaydi — bekor qilinmagan buyurtmalardagi pozitsiyalardan hisoblanadi (lokal ↔ bulut uchun xavfsiz).
import type { Ctx } from '../core/context.ts';

export default function deals(ctx: Ctx) {
  const { db, route, ROLES, int, fail, now, audit, broadcast, z, parse, sync, imgRef } = ctx;
  db.exec(`CREATE TABLE IF NOT EXISTS evening_deals (
    id INTEGER PRIMARY KEY, business_id INTEGER NOT NULL, product_id INTEGER NOT NULL, qty_total INTEGER NOT NULL, percent INTEGER NOT NULL,
    starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, active INTEGER DEFAULT 1, created_by INTEGER, created_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_deals_biz ON evening_deals(business_id, ends_at);`);
  sync.installTriggers();
  const dlv = ctx.dlv;

  const sold = (dealId: number, b: number) => db.prepare(`SELECT COALESCE(SUM(json_extract(j.value,'$.qty')),0) s FROM delivery_orders o, json_each(o.items) j
    WHERE o.business_id=? AND o.status NOT IN ('cancelled','rejected') AND json_extract(j.value,'$.deal_id')=?`).get(b, dealId).s;
  const dealPrice = (price: number, percent: number) => Math.max(0, Math.round((price * (100 - percent)) / 100 / 100) * 100); // 100 so'mga yaxlitlanadi
  const view = (d, withProduct = true) => {
    const pr = db.prepare('SELECT id, name, price, image, sold_by, step_g FROM products WHERE id=?').get(d.product_id);
    const s = sold(d.id, d.business_id);
    const live = !!d.active && d.starts_at <= now() && d.ends_at > now();
    return { id: d.id, product_id: d.product_id, qty_total: d.qty_total, sold: s, left: Math.max(0, d.qty_total - s), percent: d.percent, starts_at: d.starts_at, ends_at: d.ends_at,
      active: !!d.active, live: live && d.qty_total - s > 0, price: pr ? dealPrice(pr.price, d.percent) : 0, old_price: pr?.price ?? 0, ...(withProduct && pr ? { product: imgRef(pr) } : {}) };
  };

  // ---------- Restoran (kassa) ----------
  route('GET', '/api/deals', ROLES.CASH, ({ user }) =>
    db.prepare('SELECT * FROM evening_deals WHERE business_id=? AND ends_at>? ORDER BY active DESC, ends_at').all(user.business_id, new Date(Date.now() - 12 * 36e5).toISOString()).map((d) => view(d)));
  const DealBody = z.object({
    product_id: z.coerce.number().int().positive(), qty: z.coerce.number().int().min(1).max(500), percent: z.coerce.number().int().min(10).max(90),
    until: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM'),
  });
  route('POST', '/api/deals', ROLES.CASH, ({ user, body }) => {
    const b = user.business_id;
    const v = parse(DealBody, body);
    const pr = db.prepare('SELECT * FROM products WHERE id=? AND business_id=? AND active=1').get(v.product_id, b) || fail(404, 'Taom topilmadi');
    if (pr.sold_by === 'kg') fail(400, "Og'irlik bilan sotiladigan mahsulotga kechki chegirma hozircha yo'q");
    const end = new Date(); const [h, m] = v.until.split(':').map(Number); end.setHours(h, m, 0, 0);
    if (+end <= Date.now()) end.setDate(end.getDate() + 1); // yarim tundan keyingi vaqt — ertangi kun
    if (+end - Date.now() > 12 * 36e5) fail(400, "Chegirma ko'pi bilan 12 soatga");
    if (db.prepare('SELECT 1 FROM evening_deals WHERE business_id=? AND product_id=? AND active=1 AND ends_at>?').get(b, pr.id, now())) fail(409, `"${pr.name}" uchun faol chegirma bor`);
    const id = db.prepare('INSERT INTO evening_deals (business_id,product_id,qty_total,percent,starts_at,ends_at,active,created_by,created_at) VALUES (?,?,?,?,?,?,1,?,?)')
      .run(b, pr.id, v.qty, v.percent, now(), end.toISOString(), user.id, now()).lastInsertRowid;
    audit(user, 'deal_create', 'evening_deals', id, { product: pr.name, qty: v.qty, percent: v.percent, until: end.toISOString() });
    broadcast(b, 'delivery', { deal: id });
    return view(db.prepare('SELECT * FROM evening_deals WHERE id=?').get(id));
  });
  route('POST', '/api/deals/:id/stop', ROLES.CASH, ({ user, p }) => {
    const d = db.prepare('SELECT * FROM evening_deals WHERE id=? AND business_id=?').get(int(p.id, 'id'), user.business_id) || fail(404, 'Chegirma topilmadi');
    db.prepare('UPDATE evening_deals SET active=0 WHERE id=?').run(d.id);
    audit(user, 'deal_stop', 'evening_deals', d.id, {});
    broadcast(user.business_id, 'delivery', { deal: d.id });
    return view(db.prepare('SELECT * FROM evening_deals WHERE id=?').get(d.id));
  });

  // ---------- Mijoz ----------
  const liveFor = (b: number) => db.prepare('SELECT * FROM evening_deals WHERE business_id=? AND active=1 AND starts_at<=? AND ends_at>?').all(b, now(), now()).map((d) => view(d)).filter((d) => d.live);
  route('GET', '/api/c/deals', null, () => {
    const out = [];
    for (const r of db.prepare('SELECT DISTINCT business_id FROM evening_deals WHERE active=1 AND ends_at>?').all(now())) {
      if (!dlv.isOpenPlace(r.business_id)) continue;
      const b = db.prepare('SELECT name, code FROM businesses WHERE id=?').get(r.business_id);
      for (const d of liveFor(r.business_id)) out.push({ ...d, place: b.name, place_code: b.code });
    }
    return out.sort((a, z2) => z2.percent - a.percent);
  });

  /** Savatdagi pozitsiya uchun: chegirma amal qiladimi va qancha qoldi */
  function priceFor(b: number, productId: number, dealId: number, qty: number) {
    const d = db.prepare('SELECT * FROM evening_deals WHERE id=? AND business_id=?').get(dealId, b);
    if (!d || d.product_id !== productId) fail(404, 'Chegirma topilmadi');
    const v = view(d, false);
    if (!v.live) fail(409, 'Kechki chegirma tugagan');
    if (qty > v.left) fail(409, `Chegirmali taomdan faqat ${v.left} ta qoldi`);
    return v.price;
  }
  return { forPlace: liveFor, priceFor, sold };
}
