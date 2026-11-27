// 10-etap testi: Eskiz SMS (soxta server, token yangilash), Play tekshiruvchi raqami, huquqiy sahifalar va rekvizitlar,
// mijoz/kuryer akkauntini o'chirish (cheklovlar, anonimlash, qarz qaytishi), platforma tizim holati.
const { spawn } = require('child_process');
const ready = require('./_ready.cjs');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const APP = path.join(__dirname, '..', 'src', 'server.ts'), B = 'http://127.0.0.1:8080', DIR = '/tmp/launchT';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(t, method, p, body) {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { _s: r.status }) : { ...j, _s: r.status };
}

(async () => {
  // ---- Soxta Eskiz: login → token; birinchi token 2-yuborishda "eskiradi" (401) — server qayta kirishi kerak
  const sms = [], logins = [];
  let tokN = 0;
  const mock = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c)); req.on('end', async () => {
      const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/auth/login') {
        logins.push(form.get('email'));
        if (form.get('password') !== 'eskiz-pass') { res.statusCode = 401; return res.end('{"message":"Invalid credentials"}'); }
        return res.end(JSON.stringify({ data: { token: 'tok' + ++tokN } }));
      }
      const auth = req.headers.authorization;
      if (auth === 'Bearer tok1' && sms.length >= 1) { res.statusCode = 401; return res.end('{"message":"Expired"}'); }
      sms.push({ auth, phone: form.get('mobile_phone'), text: form.get('message'), from: form.get('from') });
      res.end(JSON.stringify({ id: 'sms-' + sms.length, status: 'waiting' }));
    });
  }).listen(8096);
  const codeOf = (phone) => { const m = [...sms].reverse().find((s) => s.phone === phone); return m && (m.text.match(/(\d{5})/) || [])[1]; };

  fs.rmSync(DIR, { recursive: true, force: true });
  const env = { ...process.env, DATA_DIR: DIR, PLATFORM_PASSWORD: 'pp-123456', SMS_MODE: 'eskiz', ESKIZ_URL: 'http://127.0.0.1:8096/api', ESKIZ_EMAIL: 'dx@test.uz',
    ESKIZ_PASSWORD: 'eskiz-pass', ESKIZ_FROM: 'FastHub', REVIEW_PHONE: '998900000001', REVIEW_CODE: '24680' };
  const proc = spawn('node', [APP], { env, stdio: 'ignore' });
  await ready();
  const db = new DatabaseSync(path.join(DIR, 'db.sqlite'));
  try {
    const h = await api(null, 'GET', '/api/health');
    check(h.ok && h.db === true, '/api/health bazani ham tekshiradi');

    // ---- Eskiz SMS
    const A = '998901112233', K = '998935556677';
    let r = await api(null, 'POST', '/api/c/otp', { phone: '90 111 22 33' });
    check(r.ok && r.dev_code === undefined && sms.length === 1, 'Eskiz rejimida kod ekranga chiqmaydi, SMS yuborildi');
    check(sms[0].phone === A && /FastHub tasdiqlash kodi: \d{5}/.test(sms[0].text) && sms[0].from === 'FastHub' && sms[0].auth === 'Bearer tok1', "SMS: raqam, shablon matni, jo'natuvchi, token");
    r = await api(null, 'POST', '/api/k/otp', { phone: K });
    check(r.ok && logins.length === 2 && sms.at(-1).auth === 'Bearer tok2', 'Token eskirsa (401) — server qayta kirib, SMS ni yuboradi');

    // ---- Play tekshiruvchi raqami: SMS ketmaydi, doimiy kod
    const n = sms.length;
    r = await api(null, 'POST', '/api/c/otp', { phone: '998900000001' });
    const rv = await api(null, 'POST', '/api/c/login', { phone: '998900000001', code: '24680', name: 'Google Review' });
    check(r.ok && sms.length === n && rv.token, 'REVIEW_PHONE: SMS yuborilmaydi, REVIEW_CODE bilan kiradi');

    // ---- Huquqiy sahifalar va rekvizitlar
    for (const [p, t] of [['/legal/privacy', 'Maxfiylik siyosati'], ['/legal/terms', 'oferta'], ['/legal/delete', "Akkauntni o'chirish"]]) {
      const res = await fetch(B + p); const html = await res.text();
      check(res.status === 200 && /text\/html/.test(res.headers.get('content-type')) && html.includes(t) && html.includes('/legal/legal.js'), `${p} sahifasi ochiladi`);
    }
    const pl = await api(null, 'POST', '/api/platform/login', { password: 'pp-123456' }), PT = pl.token;
    check((await api(null, 'GET', '/api/platform/legal'))._s === 401 && (await api(null, 'GET', '/api/platform/system'))._s === 401, 'Rekvizit va tizim holati — faqat platformaga');
    r = await api(PT, 'POST', '/api/platform/legal', { updated: '27.11.2026' });
    check(r._s === 400, "Sana noto'g'ri formatda — rad");
    await api(PT, 'POST', '/api/platform/legal', { company: 'FastHub MChJ', inn: '312345678', address: 'Navoiy sh., Navoiy ko\'chasi 1', phone: '+998 79 000 00 00', email: 'support@fasthub.uz', updated: '2026-11-27' });
    r = await api(null, 'GET', '/api/legal');
    check(r.company === 'FastHub MChJ' && r.inn === '312345678' && r.updated === '2026-11-27' && r.app === 'FastHub Uz', 'Rekvizitlar saqlandi va ochiq /api/legal da');

    // ---- Mijoz akkauntini o'chirish
    let c = await api(null, 'POST', '/api/c/login', { phone: A, code: codeOf(A), name: 'Aziz' });
    const CT = c.token, uid = c.user.id;
    check(!!CT, 'Mijoz Eskiz kodi bilan kirdi');
    db.prepare("INSERT INTO delivery_orders (business_id,app_user_id,phone,name,items,status,address,lat,lng,created_at) VALUES (1,?,?,?,'[]','on_way','Navoiy, 5-mikrorayon',40.1,65.3,?)")
      .run(uid, A, 'Aziz', new Date().toISOString());
    const oid = db.prepare('SELECT MAX(id) id FROM delivery_orders').get().id;
    await api(null, 'POST', '/api/c/otp', { phone: A }).catch(() => {});
    await wait(50);
    r = await api(null, 'POST', '/api/account/delete', { kind: 'customer', phone: A, code: '00000' });
    check(r._s === 400, "Noto'g'ri SMS kod — o'chirilmaydi");
    db.prepare("DELETE FROM otp_codes").run(); // 1 daqiqalik limitni chetlab: kodni qayta so'rash uchun
    await api(null, 'POST', '/api/c/otp', { phone: A });
    r = await api(null, 'POST', '/api/account/delete', { kind: 'customer', phone: A, code: codeOf(A) });
    check(r._s === 409 && /Faol buyurtma/.test(r.error), "Faol buyurtma bor — o'chirilmaydi");
    db.prepare("UPDATE delivery_orders SET status='delivered' WHERE id=?").run(oid);
    db.prepare('UPDATE app_users SET debt=7000, no_shows=1 WHERE id=?').run(uid);
    db.prepare("DELETE FROM otp_codes").run();
    await api(null, 'POST', '/api/c/otp', { phone: A });
    r = await api(null, 'POST', '/api/account/delete', { kind: 'customer', phone: A, code: codeOf(A), reason: 'Endi kerak emas' });
    check(r.ok && r.status === 'done', "Mijoz akkaunti o'chirildi");
    const u = db.prepare('SELECT * FROM app_users WHERE id=?').get(uid), o = db.prepare('SELECT * FROM delivery_orders WHERE id=?').get(oid);
    check(u.phone === `deleted-${uid}` && u.name === '' && u.blocked === 1, 'Telefon va ism anonimlandi');
    check(o.name === '' && o.phone === '' && o.address === '' && o.lat === null, 'Buyurtma qoldi, lekin ismsiz/telefonsiz/manzilsiz');
    const del = db.prepare("SELECT * FROM account_deletions WHERE kind='customer' AND ref_id=?").get(uid);
    check(del && del.phone_hash.length === 64 && !del.phone_hash.includes(A) && del.debt === 7000, "O'chirish yozuvida telefon ochiq emas (xesh), qarz saqlangan");
    check((await api(CT, 'GET', '/api/c/me'))._s === 401, 'Eski seans ishlamaydi');
    db.prepare("DELETE FROM otp_codes").run();
    await api(null, 'POST', '/api/c/otp', { phone: A });
    c = await api(null, 'POST', '/api/c/login', { phone: A, code: codeOf(A) });
    const me2 = await api(c.token, 'GET', '/api/c/me');
    check(c.user.id !== uid && me2.debt === 7000, "Qayta ro'yxatdan o'tganda eski qarz qaytadi (firibgarlikdan himoya)");

    // ---- Kuryer akkauntini o'chirish
    db.prepare("DELETE FROM otp_codes").run();
    await api(null, 'POST', '/api/k/otp', { phone: K });
    const k = await api(null, 'POST', '/api/k/login', { phone: K, code: codeOf(K) }), KT = k.token, kid = k.me.id;
    db.prepare("INSERT INTO courier_docs (courier_id,kind,data,created_at) VALUES (?,'passport','data:image/jpeg;base64,AAAA',?)").run(kid, new Date().toISOString());
    db.prepare("INSERT INTO courier_moves (courier_id,type,amount,note,at) VALUES (?,'fee',12000,'test',?)").run(kid, new Date().toISOString());
    db.prepare("DELETE FROM otp_codes").run();
    await api(null, 'POST', '/api/k/otp', { phone: K });
    r = await api(null, 'POST', '/api/account/delete', { kind: 'courier', phone: K, code: codeOf(K) });
    check(r.ok && r.status === 'pending', "Kuryer hisobida pul bor — so'rov ochildi, darhol o'chmaydi");
    check((await api(KT, 'GET', '/api/k/state'))._s === 401 && db.prepare('SELECT status FROM couriers WHERE id=?').get(kid).status === 'deleting', 'Kuryer seansi yopildi, holat "deleting"');
    let list = await api(PT, 'GET', '/api/platform/deletions');
    const pend = list.find((d) => d.kind === 'courier' && d.status === 'pending');
    check(pend && pend.balance === 12000 && pend.phone === K, "Platformada so'rov: balans va telefon ko'rinadi");
    r = await api(PT, 'POST', `/api/platform/deletions/${pend.id}/done`);
    check(r._s === 409 && /hisob-kitob/.test(r.error), "Hisob-kitobsiz o'chirib bo'lmaydi");
    db.prepare("INSERT INTO courier_moves (courier_id,type,amount,note,at) VALUES (?,'payout',-12000,'test',?)").run(kid, new Date().toISOString());
    r = await api(PT, 'POST', `/api/platform/deletions/${pend.id}/done`);
    const kc = db.prepare('SELECT * FROM couriers WHERE id=?').get(kid);
    check(r.ok && kc.status === 'deleted' && kc.phone === `deleted-${kid}` && !db.prepare('SELECT 1 FROM courier_docs WHERE courier_id=?').get(kid), "Hisob-kitobdan keyin: kuryer anonimlandi, hujjat rasmlari o'chdi");
    const K2 = '998977778899';
    await api(null, 'POST', '/api/k/otp', { phone: K2 });
    const k2 = await api(null, 'POST', '/api/k/login', { phone: K2, code: codeOf(K2) });
    db.prepare("DELETE FROM otp_codes").run();
    await api(null, 'POST', '/api/k/otp', { phone: K2 });
    r = await api(null, 'POST', '/api/account/delete', { kind: 'courier', phone: K2, code: codeOf(K2) });
    check(k2.token && r.ok && r.status === 'done', "Hisobi bo'sh kuryer — darhol o'chirildi");
    r = await api(null, 'POST', '/api/account/delete', { kind: 'courier', phone: '998911111111', code: '12345' });
    check(r._s === 400, "Kod so'ralmagan raqam — rad");

    // ---- Tizim holati
    const s = await api(PT, 'GET', '/api/platform/system');
    const ck = Object.fromEntries(s.checklist.map((x) => [x.key, x.ok]));
    check(s.version && s.backups.count >= 1 && s.backups.age_h < 1 && s.errors.total === 0 && s.db_mb >= 0, 'Tizim holati: versiya, zaxira, xatolar, baza hajmi');
    check(ck.sms && ck.review && ck.legal && ck.backup && ck.password && !ck.offsite && !ck.alerts, "Ishga chiqarish ro'yxati to'g'ri (SMS, demo raqam, rekvizit, zaxira ✓; tashqi zaxira, ogohlantirish —)");
    check(s.services.sms === 'eskiz' && s.deletions_pending === 0, 'Xizmatlar holati va kutayotgan so\'rovlar soni');
  } catch (e) { console.error(e); bad++; }
  finally { db.close(); proc.kill(); mock.close(); }
  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  process.exit(bad ? 1 : 0);
})();
