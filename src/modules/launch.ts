// 10-etap: ishga chiqarish — huquqiy rekvizitlar (maxfiylik siyosati, oferta sahifalari uchun), akkauntni o'chirish (Google Play talabi),
// tizim holati (zaxira, xatolar, xizmatlar) va ishga chiqarish ro'yxati (platforma paneli → 🚀 Ishga chiqarish).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Ctx } from '../core/context.ts';
import * as monitor from '../core/monitor.ts';
import * as sms from '../services/sms.ts';
import { ROOT } from '../core/config.ts';

// O'chirilgan akkauntning telefoni ochiq saqlanmaydi — faqat HMAC (qayta ro'yxatdan o'tganda qarzni qaytarish uchun)
const PHONE_SALT = 'dasturxon-deleted-v1';
const ACTIVE = ['new', 'awaiting_payment', 'accepted', 'ready', 'on_way'];
const LEGAL_KEYS = ['company', 'inn', 'address', 'phone', 'email', 'telegram', 'updated'] as const;

export default function launch(ctx: Ctx) {
  const { db, route, fail, now, parse, z, DATA_DIR, tenant, dlv, courier } = ctx;
  db.exec(`
  CREATE TABLE IF NOT EXISTS account_deletions (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, ref_id INTEGER NOT NULL, phone_hash TEXT NOT NULL,
    status TEXT DEFAULT 'pending', reason TEXT DEFAULT '', debt INTEGER DEFAULT 0, no_shows INTEGER DEFAULT 0, note TEXT DEFAULT '',
    requested_at TEXT, done_at TEXT);
  CREATE INDEX IF NOT EXISTS idx_del_phone ON account_deletions(kind, phone_hash);
  `);
  const phoneHash = (p: string) => crypto.createHmac('sha256', PHONE_SALT).update(p).digest('hex');
  const plog = (action: string, entity: string, id: number, details: object) =>
    db.prepare('INSERT INTO platform_log (action,entity,entity_id,details,at) VALUES (?,?,?,?,?)').run(action, entity, id, JSON.stringify(details), now());

  // ---------- Huquqiy rekvizitlar (platforma egasi kiritadi; sahifalar /legal/* shu yerdan oladi) ----------
  const legal = () => Object.fromEntries(LEGAL_KEYS.map((k) => [k, db.prepare('SELECT value FROM platform_settings WHERE key=?').get('legal_' + k)?.value || '']));
  route('GET', '/api/legal', null, () => ({ app: 'FastHub Uz', ...legal() }));
  route('GET', '/api/platform/legal', null, ({ req }) => { tenant.platAuth(req); return legal(); });
  route('POST', '/api/platform/legal', null, ({ req, body }) => {
    tenant.platAuth(req);
    const b = parse(z.object(Object.fromEntries(LEGAL_KEYS.map((k) => [k, z.string().trim().max(300).optional()]))), body);
    if (b.updated && !/^\d{4}-\d{2}-\d{2}$/.test(b.updated)) fail(400, "Sana YYYY-MM-DD ko'rinishida bo'lsin");
    for (const [k, v] of Object.entries(b)) if (v != null)
      db.prepare('INSERT INTO platform_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('legal_' + k, v);
    plog('legal_update', 'platform', 0, {});
    return legal();
  });

  // ---------- Akkauntni o'chirish: ilova ichida va veb sahifada (/legal/delete) — SMS kod bilan ----------
  // Mijoz: faol buyurtma, ochiq nizo yoki kutilayotgan qaytarish bo'lsa — keyin. Aks holda darhol: shaxsiy ma'lumotlar o'chadi,
  //   buyurtmalar (buxgalteriya uchun) ismsiz/telefonsiz qoladi, qarz va no-show soni telefon xeshi bilan saqlanadi.
  function deleteCustomer(phone: string, reason: string) {
    const u = db.prepare('SELECT * FROM app_users WHERE phone=?').get(phone) || fail(404, 'Bu raqam bilan akkaunt topilmadi');
    if (db.prepare(`SELECT 1 FROM delivery_orders WHERE app_user_id=? AND status IN (${ACTIVE.map(() => '?').join(',')})`).get(u.id, ...ACTIVE))
      fail(409, "Faol buyurtmangiz bor. Yakunlangach o'chiring");
    if (db.prepare("SELECT 1 FROM disputes WHERE app_user_id=? AND (status='open' OR appeal_status='open')").get(u.id))
      fail(409, "Ochiq shikoyatingiz bor. Hal qilingach o'chiring");
    if (db.prepare("SELECT 1 FROM refunds WHERE phone=? AND status='pending'").get(phone))
      fail(409, "Sizga pul qaytarilishi kutilmoqda. Qaytarilgach o'chiring");
    const orders = db.prepare('SELECT id FROM delivery_orders WHERE app_user_id=?').all(u.id).map((o) => o.id);
    db.prepare('UPDATE app_users SET phone=?, name=?, blocked=1 WHERE id=?').run(`deleted-${u.id}`, '', u.id);
    db.prepare("UPDATE delivery_orders SET name='', phone='', address='', lat=NULL, lng=NULL, note='' WHERE app_user_id=?").run(u.id);
    if (orders.length) db.prepare(`DELETE FROM delivery_photos WHERE order_id IN (${orders.map(() => '?').join(',')})`).run(...orders);
    db.prepare('DELETE FROM app_sessions WHERE user_id=?').run(u.id);
    db.prepare("DELETE FROM push_tokens WHERE kind='customer' AND owner_id=?").run(u.id);
    db.prepare('UPDATE refunds SET phone=? WHERE phone=?').run(`deleted-${u.id}`, phone);
    const id = db.prepare("INSERT INTO account_deletions (kind,ref_id,phone_hash,status,reason,debt,no_shows,requested_at,done_at) VALUES ('customer',?,?,'done',?,?,?,?,?)")
      .run(u.id, phoneHash(phone), reason, u.debt || 0, u.no_shows || 0, now(), now()).lastInsertRowid;
    plog('account_deleted', 'app_user', u.id, { deletion: id });
    return { ok: true, status: 'done', message: "Akkauntingiz o'chirildi" };
  }
  // Qayta ro'yxatdan o'tgan mijozga eski qarz va no-show tarixi qaytadi (firibgarlikdan himoya)
  dlv.ext.onNewUser = (u) => {
    const d = db.prepare("SELECT SUM(debt) debt, SUM(no_shows) ns FROM account_deletions WHERE kind='customer' AND phone_hash=?").get(phoneHash(u.phone));
    if (d?.debt || d?.ns) db.prepare('UPDATE app_users SET debt=debt+?, no_shows=no_shows+? WHERE id=?').run(d.debt || 0, d.ns || 0, u.id);
  };

  // Kuryer: faol buyurtma bo'lsa — keyin. Hisobda pul (qarz/haq) yoki depozit bo'lsa — so'rov ochiladi, platforma hisob-kitobdan keyin yakunlaydi.
  function anonymizeCourier(c) {
    db.prepare("UPDATE couriers SET phone=?, name='', vehicle_no='', lat=NULL, lng=NULL, online=0, status='deleted', status_reason='' WHERE id=?").run(`deleted-${c.id}`, c.id);
    db.prepare('DELETE FROM courier_docs WHERE courier_id=?').run(c.id); // pasport, selfi, guvohnoma rasmlari
    db.prepare('DELETE FROM courier_sessions WHERE courier_id=?').run(c.id);
    db.prepare("DELETE FROM push_tokens WHERE kind='courier' AND owner_id=?").run(c.id);
  }
  function deleteCourier(phone: string, reason: string) {
    const c = db.prepare('SELECT * FROM couriers WHERE phone=?').get(phone) || fail(404, 'Bu raqam bilan kuryer topilmadi');
    if (db.prepare(`SELECT 1 FROM delivery_orders WHERE courier_id=? AND status IN (${ACTIVE.map(() => '?').join(',')})`).get(c.id, ...ACTIVE))
      fail(409, "Sizda faol buyurtma bor. Yetkazgach o'chiring");
    const m = courier.money(c.id);
    const settle = m.balance !== 0 || (c.deposit || 0) > 0;
    const hash = phoneHash(phone);
    const prev = db.prepare("SELECT id FROM account_deletions WHERE kind='courier' AND ref_id=? AND status='pending'").get(c.id);
    if (settle) {
      if (!prev) db.prepare("INSERT INTO account_deletions (kind,ref_id,phone_hash,status,reason,requested_at) VALUES ('courier',?,?,'pending',?,?)").run(c.id, hash, reason, now());
      db.prepare("UPDATE couriers SET online=0, status='deleting', status_reason=? WHERE id=?").run("O'chirish so'ralgan — hisob-kitob kutilmoqda", c.id);
      db.prepare('DELETE FROM courier_sessions WHERE courier_id=?').run(c.id);
      plog('account_delete_request', 'courier', c.id, { balance: m.balance, deposit: c.deposit });
      return { ok: true, status: 'pending', message: "So'rov qabul qilindi. Hisob-kitob (naqd, daromad, depozit) yakunlangach akkaunt o'chiriladi — platforma siz bilan bog'lanadi" };
    }
    anonymizeCourier(c);
    if (prev) db.prepare("UPDATE account_deletions SET status='done', done_at=? WHERE id=?").run(now(), prev.id);
    else db.prepare("INSERT INTO account_deletions (kind,ref_id,phone_hash,status,reason,requested_at,done_at) VALUES ('courier',?,?,'done',?,?,?)").run(c.id, hash, reason, now(), now());
    plog('account_deleted', 'courier', c.id, {});
    return { ok: true, status: 'done', message: "Akkauntingiz o'chirildi" };
  }
  route('POST', '/api/account/delete', null, ({ body }) => {
    const b = parse(z.object({ kind: z.enum(['customer', 'courier']), phone: z.string(), code: z.string().trim().min(4).max(8), reason: z.string().trim().max(300).optional() }), body);
    const phone = dlv.phoneNorm(b.phone);
    dlv.otpCheck(b.kind === 'courier' ? 'k' + phone : phone, b.code);
    return b.kind === 'courier' ? deleteCourier(phone, b.reason || '') : deleteCustomer(phone, b.reason || '');
  });
  route('GET', '/api/platform/deletions', null, ({ req }) => {
    tenant.platAuth(req);
    return db.prepare('SELECT * FROM account_deletions ORDER BY status=\'pending\' DESC, id DESC LIMIT 200').all().map((d) => {
      if (d.kind !== 'courier' || d.status !== 'pending') return d;
      const c = courier.getC(d.ref_id);
      return { ...d, name: c?.name, phone: c?.phone, balance: courier.money(d.ref_id).balance, deposit: c?.deposit || 0 };
    });
  });
  route('POST', '/api/platform/deletions/:id/done', null, ({ req, p }) => {
    tenant.platAuth(req);
    const d = db.prepare("SELECT * FROM account_deletions WHERE id=? AND status='pending'").get(Number(p.id)) || fail(404, "So'rov topilmadi");
    const c = courier.getC(d.ref_id) || fail(404, 'Kuryer topilmadi');
    const bal = courier.money(c.id).balance;
    if (bal !== 0 || (c.deposit || 0) > 0) fail(409, `Avval hisob-kitob qiling: balans ${bal} so'm, depozit ${c.deposit || 0} so'm (Kuryerlar → Pul)`);
    anonymizeCourier(c);
    db.prepare("UPDATE account_deletions SET status='done', done_at=? WHERE id=?").run(now(), d.id);
    plog('account_deleted', 'courier', c.id, { deletion: d.id });
    return { ok: true };
  });

  // ---------- Tizim holati va ishga chiqarish ro'yxati ----------
  function backups() {
    const dir = path.join(DATA_DIR, 'backups');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t) : [];
    let offsite = null; // deploy/backup-offsite.sh yozadi
    try { offsite = JSON.parse(fs.readFileSync(path.join(dir, 'offsite.json'), 'utf8')); } catch {}
    const last = files[0];
    return { count: files.length, last_file: last?.f || null, last_at: last ? new Date(last.t).toISOString() : null, age_h: last ? Math.round((Date.now() - last.t) / 36e5 * 10) / 10 : null, offsite };
  }
  const fileMb = (f: string) => { try { return Math.round(fs.statSync(f).size / 1e5) / 10; } catch { return 0; } };
  route('GET', '/api/platform/system', null, ({ req }) => {
    tenant.platAuth(req);
    const env = process.env, bk = backups(), lg = legal(), mon = monitor.status();
    const offsiteOk = !!bk.offsite?.ok && Date.now() - +new Date(bk.offsite.at) < 30 * 36e5;
    const checks: [string, boolean, string][] = [
      ['mode', ctx.config.MODE === 'cloud', "Server bulut rejimida (MODE=cloud, HTTPS ortida)"],
      ['password', !!env.PLATFORM_PASSWORD, 'Platforma paroli .env da (PLATFORM_PASSWORD)'],
      ['sms', sms.MODE !== 'test', 'Haqiqiy SMS (SMS_MODE=eskiz + shablon tasdiqlangan)'],
      ['push', env.PUSH_MODE === 'fcm', 'Push xabarlar (PUSH_MODE=fcm, Firebase service account)'],
      ['payme', !!(env.PAYME_MERCHANT_ID && env.PAYME_KEY) && env.PAYME_TEST !== '1', 'Payme haqiqiy merchant'],
      ['click', !!(env.CLICK_SERVICE_ID && env.CLICK_SECRET_KEY), 'Click merchant'],
      ['legal', !!(lg.company && lg.inn && lg.address && lg.phone && lg.email), "Rekvizitlar to'ldirilgan (maxfiylik siyosati va oferta uchun)"],
      ['backup', bk.age_h != null && bk.age_h < 26, 'Kunlik zaxira nusxa (oxirgisi 26 soatdan yangi)'],
      ['offsite', offsiteOk, 'Zaxira boshqa joyga ham ketyapti (deploy/backup-offsite.sh)'],
      ['alerts', mon.alerts, 'Xatolar Telegramga keladi (ALERT_TG_TOKEN, ALERT_TG_CHAT)'],
      ['review', !!(env.REVIEW_PHONE && env.REVIEW_CODE), 'Play tekshiruvchisi uchun demo raqam (REVIEW_PHONE, REVIEW_CODE)'],
    ];
    const mem = process.memoryUsage();
    return {
      version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
      mode: ctx.config.MODE, node: process.version, uptime_s: mon.uptime_s, memory_mb: Math.round(mem.rss / 1e6),
      db_mb: fileMb(path.join(DATA_DIR, 'db.sqlite')), backups: bk, errors: { total: mon.total, recent: mon.recent.slice(0, 20) },
      services: { sms: sms.MODE, push: env.PUSH_MODE || 'off' },
      deletions_pending: db.prepare("SELECT COUNT(*) n FROM account_deletions WHERE status='pending'").get().n,
      checklist: checks.map(([key, ok, text]) => ({ key, ok, text })),
    };
  });
  return { deleteCustomer, deleteCourier };
}
