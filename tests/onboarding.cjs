// Hamkorlikka qabul testi: biznes so'rovnomasi + maxfiylik testi → ariza → platforma tasdiqlashi; kuryer so'rovnomasi va rozilik testi.
const { spawn } = require('child_process');
const ready = require('./_ready.cjs');
const ONB = require('./_onboard.cjs');
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'src', 'server.ts'), B = 'http://127.0.0.1:8080', DIR = '/tmp/onbT';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const IMG = 'data:image/jpeg;base64,' + Buffer.alloc(600, 7).toString('base64');
async function api(t, method, p, body) {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { _s: r.status }) : { ...j, _s: r.status };
}
const reg = (phone, extra = {}) => api(null, 'POST', '/api/register', { business_name: 'Bahor ' + phone, owner_name: 'Sardor', phone, password: 'parol123', admin_pin: '1234', ...ONB.BIZ, ...extra });

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  const proc = spawn('node', [APP], { env: { ...process.env, DATA_DIR: DIR, PLATFORM_PASSWORD: 'pp-123456', REGISTER_LIMIT: '50' }, stdio: 'ignore' });
  await ready();
  try {
    const plat = (await api(null, 'POST', '/api/platform/login', { password: 'pp-123456' })).token;
    let st = await api(plat, 'GET', '/api/platform/settings');
    check(st.require_approval === 0, "lokal rejimda tasdiq standart bo'yicha o'chiq");
    await api(plat, 'POST', '/api/platform/settings', { require_approval: 1 });

    // ---- Biznes: so'rovnoma va maxfiylik testi
    const q = await api(null, 'GET', '/api/onboarding/business');
    check(q.points.length === 5 && q.questions.length === 5 && q.questions[0].a.length === 3 && q.questions[0].right === undefined && q.approval_required, "qoidalar va 5 savol beriladi, javoblar ko'rinmaydi");
    let r = await api(null, 'POST', '/api/register', { business_name: 'X', owner_name: 'Y', phone: '901000101', password: 'parol123', admin_pin: '1234' });
    check(r._s === 400, "so'rovnomasiz ro'yxatdan o'tib bo'lmaydi");
    r = await reg('901000102', { consent: { answers: [0, 0, 0, 1, 1], agree: true } });
    check(r._s === 400 && /2-savol/.test(r.error), 'maxfiylik testida xato bo\'lsa — rad (qaysi savol aytiladi)');
    r = await reg('901000103', { consent: { answers: ONB.BIZ.consent.answers, agree: false } });
    check(r._s === 400, '"roziman" belgisisiz — rad');
    r = await reg('901000104', { application: { ...ONB.BIZ.application, place_type: 'dorixona' } });
    check(r._s === 400 && /litsenziya/.test(r.error), 'dorixona litsenziya raqamisiz — rad');
    r = await reg('901000105', { application: { ...ONB.BIZ.application, inn: '12345' } });
    check(r._s === 400 && /STIR/.test(r.error), "STIR noto'g'ri — rad");

    const a = await reg('901000106');
    check(a.approval === 'pending' && /^\d{6}$/.test(a.code), 'ariza qabul qilindi — tekshiruvda');
    r = await api(null, 'POST', '/api/login', { code: a.code, pin: '1234' });
    check(r._s === 403 && /tekshirilmoqda/.test(r.error), 'tasdiqlanmagan biznes panelga kira olmaydi');
    const ow = (await api(null, 'POST', '/api/owner/login', { phone: '901000106', password: 'parol123' })).token;
    let me = await api(ow, 'GET', '/api/owner/me');
    check(me.branches[0].approval === 'pending', "ega kabinetida ariza holati ko'rinadi");

    let apps = await api(plat, 'GET', '/api/platform/applications');
    const app = apps.find((x) => x.id === a.business_id);
    check(app && app.application.inn === '123456789' && app.application.staff_count === 5 && app.consent.score === 5 && app.consent.total === 5 && app.consent.version, 'platformada so\'rovnoma va rozilik (ball, versiya) ko\'rinadi');
    check((await api(null, 'GET', '/api/platform/applications'))._s === 401, 'arizalar faqat platformaga');
    check((await api(plat, 'POST', `/api/platform/applications/${a.business_id}`, { action: 'reject' }))._s === 400, 'rad etish sababsiz bo\'lmaydi');

    // Rad etilgan ariza
    const b2 = await reg('901000107');
    await api(plat, 'POST', `/api/platform/applications/${b2.business_id}`, { action: 'reject', note: 'STIR mos emas' });
    r = await api(null, 'POST', '/api/login', { code: b2.code, pin: '1234' });
    check(r._s === 403 && /STIR mos emas/.test(r.error), 'rad etilgan biznesga sabab bilan kirish yopiq');

    // Tasdiqlash → kirish ochiladi, sinov tasdiq kunidan, yetkazish sozlamasiga turi va manzili
    r = await api(plat, 'POST', `/api/platform/applications/${a.business_id}`, { action: 'approve' });
    check(r.approval === 'approved', 'platforma tasdiqladi');
    const adm = await api(null, 'POST', '/api/login', { code: a.code, pin: '1234' });
    check(!!adm.token, 'tasdiqdan keyin panelga kirdi');
    const ds = await api(adm.token, 'GET', '/api/delivery/settings');
    check(ds.place_type === 'restoran' && /Sinov/.test(ds.address), "so'rovnomadagi tur va manzil yetkazish sozlamasiga o'tdi");
    me = await api(ow, 'GET', '/api/owner/me');
    check(me.branches[0].approval === 'approved' && me.branches[0].pos.status === 'trial' && me.branches[0].pos.days_left >= 13, 'sinov muddati tasdiqlangan kundan');

    // Mijoz ilovasi: tasdiqlanmagan joy ko'rinmaydi
    const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
    const b3 = await reg('901000108');
    await api(plat, 'POST', `/api/platform/businesses/${b3.business_id}/subscription`, { product: 'delivery', enabled: true, paid_until: ymd(30) });
    await api(plat, 'POST', `/api/platform/businesses/${a.business_id}/subscription`, { product: 'delivery', enabled: true, paid_until: ymd(30) });
    await api(adm.token, 'POST', '/api/delivery/settings', { enabled: true, open: true });
    const db = new (require('node:sqlite').DatabaseSync)(DIR + '/db.sqlite');
    db.prepare('UPDATE delivery_settings SET enabled=1 WHERE business_id=?').run(b3.business_id); db.close();
    const places = await api(null, 'GET', '/api/c/places');
    check(places.some((p) => p.code === a.code) && !places.some((p) => p.code === b3.code), "mijoz ilovasida faqat tasdiqlangan biznes ko'rinadi");

    // ---- Kuryer: so'rovnoma va rozilik
    const cq = await api(null, 'GET', '/api/onboarding/courier');
    check(cq.questions.length === 5 && cq.points.length === 5, 'kuryerga qoidalar va 5 savol beriladi');
    const o = await api(null, 'POST', '/api/k/otp', { phone: '935550101' }); const k = (await api(null, 'POST', '/api/k/login', { phone: '935550101', code: o.dev_code })).token;
    await api(k, 'POST', '/api/k/profile', { name: 'Ali Valiyev', vehicle: 'velosiped' });
    await api(k, 'POST', '/api/k/docs', { kind: 'passport', data: IMG }); await api(k, 'POST', '/api/k/docs', { kind: 'selfie', data: IMG });
    await api(k, 'POST', '/api/k/test', { answers: [1, 1, 1, 0, 1, 1, 1, 0] });
    r = await api(k, 'POST', '/api/k/application', { ...ONB.COURIER_APP, birth_year: new Date().getFullYear() - 16 });
    check(r._s === 400 && /18/.test(r.error), "18 yoshdan kichik — so'rovnoma rad");
    r = await api(k, 'POST', '/api/k/application', { ...ONB.COURIER_APP, smartphone_gps: false });
    check(r._s === 400 && /GPS/.test(r.error), 'GPS li smartfonsiz — rad');
    r = await api(k, 'POST', '/api/k/submit');
    check(r._s === 400 && /so'rovnoma/.test(r.error), "so'rovnomasiz ariza yuborilmaydi");
    check((await api(k, 'POST', '/api/k/application', ONB.COURIER_APP)).ok, "so'rovnoma saqlandi");
    let s = await api(k, 'GET', '/api/k/state');
    check(s.me.application_done && !s.me.consent_done, "kuryer holatida: so'rovnoma bor, rozilik yo'q");
    r = await api(k, 'POST', '/api/k/consent', { answers: [0, 1, 0, 1, 1], agree: true });
    check(r.passed === false && r.wrong.join() === '0', 'xato javob — rozilik qayd etilmaydi, qaysi savol aytiladi');
    r = await api(k, 'POST', '/api/k/consent', { answers: ONB.COURIER_CONSENT.answers });
    check(r._s === 400, '"roziman" belgisisiz — rad');
    r = await api(k, 'POST', '/api/k/consent', ONB.COURIER_CONSENT);
    check(r.passed && r.score === 5, 'kuryer maxfiylik testidan o\'tdi');
    r = await api(k, 'POST', '/api/k/submit');
    check(r.status === 'pending' && r.consent_done, 'ariza yuborildi');
    check((await api(k, 'POST', '/api/k/application', ONB.COURIER_APP))._s === 409, "yuborilgan arizani o'zgartirib bo'lmaydi");
    const list = await api(plat, 'GET', '/api/platform/couriers');
    const det = await api(plat, 'GET', `/api/platform/couriers/${list[0].id}`);
    check(det.application.district === 'Navoiy shahri' && det.consent.score === 5 && det.consent.version, "platformada kuryer so'rovnomasi va roziligi ko'rinadi");
  } catch (e) { console.error(e); bad++; }
  finally { proc.kill(); }
  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  process.exit(bad ? 1 : 0);
})();
