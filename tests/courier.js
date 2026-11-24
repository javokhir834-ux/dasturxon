// 7-etap testi: kuryer ro'yxati, taqsimlash, olish (plomba), kod bilan topshirish, naqd hisobi, no-show, reyting.
const { spawn } = require('child_process');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const APP = require('path').join(__dirname, '..', 'server.js'), B = 'http://127.0.0.1:8080', DIR = '/tmp/kur';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(t, method, path, body) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { _s: r.status }) : { ...j, _s: r.status };
}
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const IMG = 'data:image/jpeg;base64,' + Buffer.alloc(600, 7).toString('base64');
const until = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(250); } return null; };
const REST = { lat: 40.1033, lng: 65.3735 }; // Navoiy markaz
const near = (m) => ({ lat: REST.lat + m / 111000, lng: REST.lng }); // shimolga m metr

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  const proc = spawn('node', [APP], { env: { ...process.env, DATA_DIR: DIR, PLATFORM_PASSWORD: 'pp-123456', NOSHOW_WAIT_SEC: '2', DISPATCH_MS: '300' }, stdio: ['ignore', 'ignore', process.env.SHOW_ERR ? 'inherit' : 'ignore'] });
  await wait(1400);
  try {
    const plat = (await api(null, 'POST', '/api/platform/login', { password: 'pp-123456' })).token;
    await api(plat, 'POST', '/api/platform/settings', { offer_seconds: 5 });
    await api(plat, 'POST', '/api/platform/businesses/1/subscription', { product: 'delivery', enabled: true, paid_until: ymd(30) });
    const adm = (await api(null, 'POST', '/api/login', { pin: '1111' })).token, kas = (await api(null, 'POST', '/api/login', { pin: '2222' })).token, cook = (await api(null, 'POST', '/api/login', { pin: '4444' })).token;
    await api(kas, 'POST', '/api/shift/open', { opening_cash: 0 });
    const st = await api(adm, 'POST', '/api/delivery/settings', { enabled: true, open: true, address: 'Navoiy markaz', delivery_fee: 8000, prepay_mode: 'mixed', ...REST });
    check(st.delivery_by === 'platform' && st.lat === REST.lat, "restoran: platforma kuryerlari va joylashuv saqlandi");
    const code = (await api(adm, 'GET', '/api/bootstrap')).business.code;
    const menu = await api(null, 'GET', `/api/c/places/${code}`);
    const osh = menu.products.find((x) => x.name.startsWith('Osh'));

    // ---------- Ro'yxat ----------
    async function courierLogin(phone) { const o = await api(null, 'POST', '/api/k/otp', { phone }); return api(null, 'POST', '/api/k/login', { phone, code: o.dev_code }); }
    const l1 = await courierLogin('935550001'); const k1 = l1.token;
    check(l1.me.status === 'draft', 'kuryer SMS kod bilan kirdi (qoralama)');
    check((await api(k1, 'POST', '/api/k/submit'))._s === 400, "ma'lumotsiz ariza yuborilmaydi");
    check((await api(k1, 'POST', '/api/k/profile', { name: 'Ali Valiyev', vehicle: 'moto' }))._s === 400, 'moto uchun davlat raqami shart');
    await api(k1, 'POST', '/api/k/profile', { name: 'Ali Valiyev', vehicle: 'moto', vehicle_no: '01a123bc' });
    await api(k1, 'POST', '/api/k/docs', { kind: 'passport', data: IMG }); await api(k1, 'POST', '/api/k/docs', { kind: 'selfie', data: IMG });
    check((await api(k1, 'POST', '/api/k/docs', { kind: 'passport', data: 'data:text/html;base64,AAA' }))._s === 400, "rasm bo'lmagan fayl rad etildi");
    let sub = await api(k1, 'POST', '/api/k/submit');
    check(sub._s === 400 && /guvohnoma/.test(sub.error), 'moto kuryerga guvohnoma rasmi shart');
    await api(k1, 'POST', '/api/k/docs', { kind: 'license', data: IMG });
    const qs = await api(k1, 'GET', '/api/k/test');
    check(qs.length === 8 && qs[0].a.length === 3 && qs[0].right === undefined, "test: 8 savol, javoblar kuryerga ko'rinmaydi");
    const bad1 = await api(k1, 'POST', '/api/k/test', { answers: [0, 0, 0, 0, 0, 0, 0, 0] });
    check(!bad1.passed && bad1.score === 2, 'xato javoblar bilan testdan o\'tmadi');
    check((await api(k1, 'POST', '/api/k/test', { answers: [1, 1, 1, 0, 1, 1, 1, 0] }))._s === 429, 'testni darhol qayta topshirib bo\'lmaydi');
    const db = new DatabaseSync(DIR + '/db.sqlite');
    db.prepare("UPDATE couriers SET test_at='2000-01-01' WHERE phone='998935550001'").run();
    check((await api(k1, 'POST', '/api/k/test', { answers: [1, 1, 1, 0, 1, 1, 1, 0] })).passed, "10 daqiqadan keyin testdan o'tdi");
    sub = await api(k1, 'POST', '/api/k/submit');
    check(sub.status === 'pending', 'ariza yuborildi (tekshiruvda)');
    check((await api(k1, 'POST', '/api/k/profile', { name: 'X', vehicle: 'piyoda' }))._s === 409, "yuborilgan arizani o'zgartirib bo'lmaydi");
    check((await api(k1, 'POST', '/api/k/online', { online: true }))._s === 403, 'tasdiqlanmagan kuryer liniyaga chiqolmaydi');
    // ikkinchi kuryer (velosiped, depozitsiz)
    const k2 = (await courierLogin('935550002')).token;
    await api(k2, 'POST', '/api/k/profile', { name: 'Vali', vehicle: 'velosiped' });
    await api(k2, 'POST', '/api/k/docs', { kind: 'passport', data: IMG }); await api(k2, 'POST', '/api/k/docs', { kind: 'selfie', data: IMG });
    await api(k2, 'POST', '/api/k/test', { answers: [1, 1, 1, 0, 1, 1, 1, 0] }); await api(k2, 'POST', '/api/k/submit');

    // ---------- Platforma tasdiqlaydi ----------
    const list = await api(plat, 'GET', '/api/platform/couriers');
    check(list.length === 2 && list.every((c) => c.status === 'pending'), "platformada 2 ta ariza ko'rinadi");
    const c1 = list.find((c) => c.phone === '998935550001'), c2 = list.find((c) => c.phone === '998935550002');
    const det = await api(plat, 'GET', `/api/platform/couriers/${c1.id}`);
    check(det.docs.length === 3 && det.docs[0].data.startsWith('data:image'), "platforma hujjat rasmlarini ko'radi");
    check((await api(plat, 'POST', `/api/platform/couriers/${c1.id}/status`, { action: 'reject' }))._s === 400, 'rad etish sababsiz bo\'lmaydi');
    check((await api(plat, 'POST', `/api/platform/couriers/${c1.id}/status`, { action: 'approve' })).status === 'probation', 'tasdiqlandi → sinov davri');
    await api(plat, 'POST', `/api/platform/couriers/${c2.id}/status`, { action: 'approve' });
    const dep = await api(plat, 'POST', `/api/platform/couriers/${c1.id}/money`, { type: 'deposit', amount: 200000 });
    check(dep.deposit === 200000 && dep.cash_limit === 150000, 'depozit 200 000 → naqd limit 150 000 (Yangi daraja)');

    await api(k1, 'POST', '/api/k/location', near(1500)); await api(k2, 'POST', '/api/k/location', near(400));
    check((await api(k1, 'POST', '/api/k/online', { online: true })).online && (await api(k2, 'POST', '/api/k/online', { online: true })).online, 'ikkala kuryer liniyada');

    // ---------- Buyurtma 1: oldindan to'langan ----------
    async function cust(phone) { const o = await api(null, 'POST', '/api/c/otp', { phone }); return (await api(null, 'POST', '/api/c/login', { phone, code: o.dev_code, name: 'Mijoz' })).token; }
    const cu = await cust('977001122');
    async function order(t, pay = 'test', qty = 2, loc = near(2000)) {
      const r = await api(t, 'POST', '/api/c/orders', { place: code, items: [{ product_id: osh.id, qty }], address: 'Navoiy, 7-mavze', provider: pay, ...loc });
      if (r.order.status === 'awaiting_payment') await api(t, 'POST', `/api/c/orders/${r.order.id}/test-pay`);
      await api(kas, 'POST', `/api/delivery/orders/${r.order.id}/accept`, { prep_minutes: 15 });
      return r.order.id;
    }
    const o1 = await order(cu);
    const off2 = await until(async () => (await api(k2, 'GET', '/api/k/state')).offer);
    check(off2 && off2.id === o1 && off2.fee === 8000 && off2.cash === 0, "eng yaqin kuryerga (400 m) taklif keldi: haqi 8 000, naqd yo'q");
    const brd = await api(kas, 'GET', '/api/delivery/orders');
    check(brd.find((o) => o.id === o1).courier?.status === 'searching' && !('handover_code' in brd.find((o) => o.id === o1) && brd.find((o) => o.id === o1).handover_code), "restoranda: 'kuryer qidirilmoqda', kod ko'rinmaydi");
    check(!(await api(k1, 'GET', '/api/k/state')).offer, 'bir vaqtda faqat bitta kuryerga taklif');
    const off1 = await until(async () => (await api(k1, 'GET', '/api/k/state')).offer, 9000);
    check(off1 && off1.id === o1, "5 soniyada javob bo'lmadi → keyingi kuryerga o'tdi");
    check((await api(k2, 'POST', `/api/k/offers/${o1}/accept`))._s === 409, 'muddati o\'tgan taklifni qabul qilib bo\'lmaydi');
    check((await api(k1, 'POST', `/api/k/offers/${o1}/accept`)).ok, 'kuryer taklifni qabul qildi');
    let co = await api(cu, 'GET', `/api/c/orders/${o1}`);
    check(co.courier?.name === 'Ali Valiyev' && co.courier.vehicle_no === '01A123BC' && /^\d{4}$/.test(co.handover_code), "mijoz kuryerni va 4 xonali kodni ko'rdi");
    let ks = await api(k1, 'GET', '/api/k/state');
    check(ks.order?.id === o1 && ks.order.customer.phone === '998977001122' && ks.order.handover_code === undefined, "kuryerda faol buyurtma, kod kuryerga berilmaydi");
    await api(k1, 'POST', `/api/k/orders/${o1}/arrived_rest`);
    check((await api(k1, 'POST', `/api/k/orders/${o1}/pickup`, { photo: IMG }))._s === 409, "tayyor bo'lmagan buyurtmani olib bo'lmaydi");
    check((await api(kas, 'POST', `/api/delivery/orders/${o1}/dispatch`))._s === 409, "restoran kuryer buyurtmasini o'zi 'yo'lda' qila olmaydi");
    for (const it of await api(cook, 'GET', '/api/kitchen')) await api(cook, 'POST', `/api/items/${it.id}/status`, { status: 'ready' });
    await until(async () => (await api(cu, 'GET', `/api/c/orders/${o1}`)).status === 'ready', 4000);
    check((await api(k1, 'POST', `/api/k/orders/${o1}/pickup`, {}))._s === 400, 'plomba rasmisiz olib bo\'lmaydi');
    check((await api(k1, 'POST', `/api/k/orders/${o1}/pickup`, { photo: IMG })).ok && (await api(cu, 'GET', `/api/c/orders/${o1}`)).status === 'on_way', "plomba rasmi bilan oldi → mijozda 'yo'lda'");
    check((await api(k1, 'POST', `/api/k/orders/${o1}/release`))._s === 409, 'olgandan keyin voz kechib bo\'lmaydi');
    co = await api(cu, 'GET', `/api/c/orders/${o1}`);
    check((await api(k1, 'POST', `/api/k/orders/${o1}/deliver`, { code: co.handover_code === '0000' ? '1111' : '0000' }))._s === 400, "noto'g'ri kod bilan topshirib bo'lmaydi");
    const dl = await api(k1, 'POST', `/api/k/orders/${o1}/deliver`, { code: co.handover_code });
    check(dl.ok && dl.cash === 0 && (await api(cu, 'GET', `/api/c/orders/${o1}`)).status === 'delivered', "to'g'ri kod → yetkazildi");
    const rep = await api(kas, 'GET', '/api/shift');
    check(rep.byMethod.onlayn === 70000 && rep.orders === 1, "restoran cheki yopildi: 70 000 onlayn");
    let me1 = (await api(k1, 'GET', '/api/k/state')).me;
    check(me1.balance === 8000 && me1.earnedToday === 8000 && me1.completed === 1 && me1.hand === 0, 'kuryer daromadi 8 000, qo\'lida naqd yo\'q');
    let fund = await api(plat, 'GET', '/api/platform/fund');
    check(fund.balance === 700, 'kafolat fondiga 1% (700) tushdi');
    check((await api(plat, 'GET', `/api/platform/orders/${o1}/photos`)).some((x) => x.kind === 'seal'), "platforma plomba rasmini ko'radi");
    check((await api(cu, 'POST', `/api/c/orders/${o1}/rate`, { stars: 4, comment: 'yaxshi' })).ok, 'mijoz kuryerni baholadi');
    check((await api(cu, 'POST', `/api/c/orders/${o1}/rate`, { stars: 5 }))._s === 409, 'ikki marta baholab bo\'lmaydi');

    // ---------- Buyurtma 2: naqd (ishonchli mijoz) — depozitsiz kuryerga bermaydi ----------
    await api(adm, 'POST', '/api/delivery/settings', { prepay_mode: 'cash' });
    const cu2 = await cust('977003344');
    const o2 = await order(cu2, null, 3);
    const tot2 = (await api(cu2, 'GET', `/api/c/orders/${o2}`)).total;
    await wait(1500);
    check(!(await api(k2, 'GET', '/api/k/state')).offer, "depozitsiz kuryerga naqd buyurtma taklif qilinmaydi");
    const of2 = await until(async () => (await api(k1, 'GET', '/api/k/state')).offer);
    check(of2 && of2.cash === tot2, `depozitli kuryerga taklif: ${tot2} naqd olish kerak`);
    await api(k1, 'POST', `/api/k/offers/${o2}/accept`);
    for (const it of await api(cook, 'GET', '/api/kitchen')) await api(cook, 'POST', `/api/items/${it.id}/status`, { status: 'ready' });
    await until(async () => (await api(cu2, 'GET', `/api/c/orders/${o2}`)).status === 'ready', 4000);
    await api(k1, 'POST', `/api/k/orders/${o2}/pickup`, { photo: IMG }); await api(k1, 'POST', `/api/k/orders/${o2}/arrived`);
    const d2 = await api(k1, 'POST', `/api/k/orders/${o2}/deliver`, { code: (await api(cu2, 'GET', `/api/c/orders/${o2}`)).handover_code });
    check(d2.cash === tot2, 'kuryer mijozdan naqd oldi');
    const rep2 = await api(kas, 'GET', '/api/shift');
    check(rep2.byMethod.kuryer === tot2 - 8000 && rep2.expectedCash === 0, "restoranda 'kuryer naqdi' — kassadagi kutilgan naqdga qo'shilmadi");
    me1 = (await api(k1, 'GET', '/api/k/state')).me;
    check(me1.hand === tot2 && me1.balance === 16000 - tot2, `kuryer qo'lida ${tot2} naqd, hisob ${16000 - tot2}`);
    check((await api(plat, 'POST', `/api/platform/couriers/${c1.id}/money`, { type: 'cash_in', amount: tot2 + 1 }))._s === 400, "qo'ldagidan ortiq naqd qabul qilinmaydi");
    me1 = await api(plat, 'POST', `/api/platform/couriers/${c1.id}/money`, { type: 'cash_in', amount: tot2 });
    check(me1.hand === 0 && me1.balance === 16000, 'kunlik hisob: naqd topshirildi, platforma kuryerga 16 000 qarzdor');
    me1 = await api(plat, 'POST', `/api/platform/couriers/${c1.id}/money`, { type: 'payout', amount: 16000 });
    check(me1.balance === 0, "kuryerga daromadi to'landi");

    // ---------- Buyurtma 3: mijoz chiqmadi (no-show) ----------
    await api(adm, 'POST', '/api/delivery/settings', { prepay_mode: 'mixed' });
    const cu3 = await cust('977005566');
    const custLoc = near(2000);
    const o3 = await order(cu3, 'test', 2, custLoc);
    await api(k2, 'POST', '/api/k/online', { online: false });
    await until(async () => (await api(k1, 'GET', '/api/k/state')).offer);
    await api(k1, 'POST', `/api/k/offers/${o3}/accept`);
    for (const it of await api(cook, 'GET', '/api/kitchen')) await api(cook, 'POST', `/api/items/${it.id}/status`, { status: 'ready' });
    await until(async () => (await api(cu3, 'GET', `/api/c/orders/${o3}`)).status === 'ready', 4000);
    await api(k1, 'POST', `/api/k/orders/${o3}/pickup`, { photo: IMG });
    check((await api(k1, 'POST', `/api/k/orders/${o3}/noshow`))._s === 409, "yetib kelmasdan 'mijoz olmadi' bosilmaydi");
    await api(k1, 'POST', `/api/k/orders/${o3}/arrived`);
    let ns = await api(k1, 'POST', `/api/k/orders/${o3}/noshow`);
    check(ns._s === 409 && /qo'ng'iroq/.test(ns.error), "qo'ng'iroqsiz bo'lmaydi");
    await api(k1, 'POST', `/api/k/orders/${o3}/call`);
    ns = await api(k1, 'POST', `/api/k/orders/${o3}/noshow`);
    check(ns._s === 409 && /rasm/.test(ns.error), "eshik rasmisiz bo'lmaydi");
    await api(k1, 'POST', `/api/k/orders/${o3}/door`, { photo: IMG });
    await api(k1, 'POST', '/api/k/location', near(500));
    await wait(2100);
    ns = await api(k1, 'POST', `/api/k/orders/${o3}/noshow`);
    check(ns._s === 409 && /uzoqdasiz/.test(ns.error), "GPS: mijoz manzilidan uzoqda bo'lsa bo'lmaydi");
    await api(k1, 'POST', '/api/k/location', custLoc);
    ns = await api(k1, 'POST', `/api/k/orders/${o3}/noshow`);
    check(ns.ok && ns.fee === 8000 && (await api(cu3, 'GET', `/api/c/orders/${o3}`)).status === 'no_show', "tartib bajarildi → 'mijoz olmadi', kuryer haqini oldi");
    const rep3 = await api(kas, 'GET', '/api/shift');
    check(rep3.byMethod.onlayn === 140000, "oldindan to'langan buyurtma — restoran pulini oldi");
    fund = await api(plat, 'GET', '/api/platform/fund');
    check(fund.balance === 700 + Math.round((tot2 - 8000) / 100), "to'liq oldindan to'langan — fonddan pul chiqmadi");
    const q3 = await api(cu3, 'POST', '/api/c/quote', { place: code, items: [{ product_id: osh.id, qty: 1 }] });
    check(q3.policy.type === 'full', "olmagan mijoz keyingi safar faqat oldindan to'laydi");

    // ---------- Buyurtma 4: voz kechish va restoran o'zi yetkazishi ----------
    await api(k2, 'POST', '/api/k/online', { online: true }); await api(k2, 'POST', '/api/k/location', near(3000));
    const o4 = await order(cu);
    const of4 = await until(async () => (await api(k1, 'GET', '/api/k/state')).offer);
    await api(k1, 'POST', `/api/k/offers/${of4.id}/accept`);
    check((await api(k1, 'POST', `/api/k/orders/${o4}/release`, { reason: "g'ildirak teshildi" })).ok, "kuryer olishdan oldin voz kechdi");
    check(!!(await until(async () => (await api(k2, 'GET', '/api/k/state')).offer?.id === o4)), "buyurtma boshqa kuryerga taklif qilindi");
    await api(k2, 'POST', `/api/k/offers/${o4}/decline`);
    const own = await api(kas, 'POST', `/api/delivery/orders/${o4}/own`);
    check(own.own_delivery === 1, "kuryer topilmadi → restoran 'o'zimiz yetkazamiz'");
    await wait(1200);
    check(!(await api(k1, 'GET', '/api/k/state')).offer && !(await api(k2, 'GET', '/api/k/state')).offer, "o'zi yetkazadigan buyurtma kuryerlarga taklif qilinmaydi");
    check((await api(kas, 'POST', `/api/delivery/orders/${o4}/delivered`)).status === 'delivered', "restoran o'zi yetkazdi");

    // ---------- Kunlik hisob va reyting ----------
    await api(adm, 'POST', '/api/delivery/settings', { prepay_mode: 'cash' });
    const o5 = await order(await cust('977007788'), null, 1);
    db.prepare("INSERT INTO courier_moves (courier_id,type,amount,note,at) VALUES (?, 'cash', -50000, 'eski', '2000-01-01T00:00:00Z')").run(c2.id);
    await api(k2, 'POST', '/api/k/online', { online: false });
    const on2 = await api(k2, 'POST', '/api/k/online', { online: true });
    check(on2._s === 409 && /topshirilmagan/.test(on2.error), "24 soatdan ortiq naqd topshirilmagan → liniyaga chiqolmaydi");
    await api(plat, 'POST', `/api/platform/couriers/${c2.id}/money`, { type: 'cash_in', amount: 50000 });
    check((await api(k2, 'POST', '/api/k/online', { online: true })).online, 'naqd topshirildi → yana liniyada');
    await api(kas, 'POST', `/api/delivery/orders/${o5}/own`);
    for (let i = 0; i < 11; i++) db.prepare("INSERT INTO delivery_orders (business_id,items,status,courier_id,courier_rating,total,subtotal) VALUES (1,'[]','delivered',?,1,0,0)").run(c2.id);
    db.prepare("UPDATE delivery_orders SET courier_id=? WHERE id=?").run(c2.id, o1);
    const cu6 = cu; const o6 = db.prepare("SELECT id FROM delivery_orders WHERE courier_id=? AND app_user_id IS NOT NULL ORDER BY id DESC LIMIT 1").get(c2.id).id;
    db.prepare('UPDATE delivery_orders SET courier_rating=NULL, app_user_id=(SELECT id FROM app_users WHERE phone=\'998977001122\') WHERE id=?').run(o6);
    await api(cu6, 'POST', `/api/c/orders/${o6}/rate`, { stars: 1 });
    const c2s = (await api(plat, 'GET', '/api/platform/couriers')).find((c) => c.id === c2.id);
    check(c2s.status === 'blocked' && /Reyting/.test(c2s.status_reason) && !c2s.online, 'reyting 4.0 dan past → avtomatik blok');
    check((await api(k2, 'POST', '/api/k/online', { online: true }))._s === 403, "bloklangan kuryer liniyaga chiqolmaydi");
    check((await api(plat, 'POST', `/api/platform/couriers/${c2.id}/status`, { action: 'unblock' })).status === 'probation', 'platforma blokdan chiqardi');
    me1 = (await api(k1, 'GET', '/api/k/state')).me;
    check(me1.level === 'Yangi' && me1.probation_left === 18 && me1.next_level?.name === 'Bronza', "daraja: Yangi, sinov davrigacha 18 ta buyurtma qoldi");
  } catch (e) { console.error(e); bad++; }
  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  proc.kill(); process.exit(bad ? 1 : 0);
})();
