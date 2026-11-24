// 8-etap testi: hisob-kitob akti, mijoz qarzi (no-show), nizolar (isbot, kompensatsiya, undirish, bosqichli choralar, e'tiroz),
// qaytarishlar, qora ro'yxat, firibgarlik belgilari, statistika.
const { spawn } = require('child_process');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const APP = require('path').join(__dirname, '..', 'server.js'), B = 'http://127.0.0.1:8080', DIR = '/tmp/plat8';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(t, method, path, body) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { _s: r.status }) : { ...j, _s: r.status };
}
const ymd = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); const z = (x) => String(x).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };
const IMG = 'data:image/jpeg;base64,' + Buffer.alloc(600, 7).toString('base64');
const until = async (fn, ms = 12000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(200); } return null; };
const REST = { lat: 40.1033, lng: 65.3735 };
const near = (m) => ({ lat: REST.lat + m / 111000, lng: REST.lng });

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  const proc = spawn('node', [APP], { env: { ...process.env, DATA_DIR: DIR, PORT: '8080', PLATFORM_PASSWORD: 'pp-123456', NOSHOW_WAIT_SEC: '1', DISPATCH_MS: '300' }, stdio: ['ignore', 'ignore', process.env.SHOW_ERR ? 'inherit' : 'ignore'] });
  await wait(1400);
  try {
    const plat = (await api(null, 'POST', '/api/platform/login', { password: 'pp-123456' })).token;
    await api(plat, 'POST', '/api/platform/businesses/1/subscription', { product: 'delivery', enabled: true, paid_until: ymd(30) });
    const adm = (await api(null, 'POST', '/api/login', { pin: '1111' })).token, kas = (await api(null, 'POST', '/api/login', { pin: '2222' })).token, cook = (await api(null, 'POST', '/api/login', { pin: '4444' })).token;
    await api(kas, 'POST', '/api/shift/open', { opening_cash: 0 });
    await api(adm, 'POST', '/api/delivery/settings', { enabled: true, open: true, address: 'Navoiy', delivery_fee: 8000, prepay_mode: 'mixed', ...REST });
    const code = (await api(adm, 'GET', '/api/bootstrap')).business.code;
    const osh = (await api(null, 'GET', `/api/c/places/${code}`)).products.find((x) => x.name.startsWith('Osh'));
    const db = new DatabaseSync(DIR + '/db.sqlite');

    // Kuryer (tasdiqlangan, depozitli, liniyada)
    const kOtp = await api(null, 'POST', '/api/k/otp', { phone: '935550001' });
    const k1 = (await api(null, 'POST', '/api/k/login', { phone: '935550001', code: kOtp.dev_code })).token;
    await api(k1, 'POST', '/api/k/profile', { name: 'Ali Valiyev', vehicle: 'velosiped' });
    await api(k1, 'POST', '/api/k/docs', { kind: 'passport', data: IMG }); await api(k1, 'POST', '/api/k/docs', { kind: 'selfie', data: IMG });
    await api(k1, 'POST', '/api/k/test', { answers: [1, 1, 1, 0, 1, 1, 1, 0] }); await api(k1, 'POST', '/api/k/submit');
    const cid = (await api(plat, 'GET', '/api/platform/couriers'))[0].id;
    await api(plat, 'POST', `/api/platform/couriers/${cid}/status`, { action: 'approve' });
    await api(plat, 'POST', `/api/platform/couriers/${cid}/money`, { type: 'deposit', amount: 200000 });
    await api(k1, 'POST', '/api/k/location', near(400)); await api(k1, 'POST', '/api/k/online', { online: true });

    async function cust(phone) { const o = await api(null, 'POST', '/api/c/otp', { phone }); return (await api(null, 'POST', '/api/c/login', { phone, code: o.dev_code, name: 'Mijoz' })).token; }
    async function order(t, qty = 2, loc = near(2000)) {
      const r = await api(t, 'POST', '/api/c/orders', { place: code, items: [{ product_id: osh.id, qty }], address: 'Navoiy, 7-mavze', provider: 'test', ...loc });
      if (r.order.status === 'awaiting_payment') await api(t, 'POST', `/api/c/orders/${r.order.id}/test-pay`);
      return r.order.id;
    }
    const accept = (id) => api(kas, 'POST', `/api/delivery/orders/${id}/accept`, { prep_minutes: 15 });
    const cookAll = async () => { for (const it of await api(cook, 'GET', '/api/kitchen')) await api(cook, 'POST', `/api/items/${it.id}/status`, { status: 'ready' }); };
    async function pickUp(id, t) {
      const of = await until(async () => (await api(k1, 'GET', '/api/k/state')).offer); await api(k1, 'POST', `/api/k/offers/${of.id}/accept`);
      await cookAll(); await until(async () => (await api(t, 'GET', `/api/c/orders/${id}`)).status === 'ready', 5000);
      await api(k1, 'POST', `/api/k/orders/${id}/pickup`, { photo: IMG });
    }
    async function deliver(id, t) { await pickUp(id, t); return api(k1, 'POST', `/api/k/orders/${id}/deliver`, { code: (await api(t, 'GET', `/api/c/orders/${id}`)).handover_code }); }

    // ---------- 1. Buyurtmalar: onlayn (kuryer), naqd (restoran o'zi), no-show (kuryer, naqd) ----------
    const cu = await cust('977001122');
    const o1 = await order(cu); await accept(o1);
    check((await deliver(o1, cu)).ok, "o1: oldindan to'langan, kuryer yetkazdi");
    await api(adm, 'POST', '/api/delivery/settings', { prepay_mode: 'cash' });
    const cu2 = await cust('977003344');
    const o2 = await order(cu2); await accept(o2); await api(kas, 'POST', `/api/delivery/orders/${o2}/own`);
    check((await api(kas, 'POST', `/api/delivery/orders/${o2}/delivered`)).status === 'delivered', "o2: naqd, restoran o'zi yetkazdi");
    const cu3 = await cust('977005566');
    const o3 = await order(cu3); await accept(o3); await pickUp(o3, cu3);
    await api(k1, 'POST', `/api/k/orders/${o3}/arrived`); await api(k1, 'POST', `/api/k/orders/${o3}/call`); await api(k1, 'POST', `/api/k/orders/${o3}/door`, { photo: IMG });
    await api(k1, 'POST', '/api/k/location', near(2000)); await wait(1100);
    check((await api(k1, 'POST', `/api/k/orders/${o3}/noshow`)).ok, "o3: naqd buyurtma, mijoz olmadi");
    const fund0 = (await api(plat, 'GET', '/api/platform/fund')).balance;

    // ---------- 2. Mijoz qarzi ----------
    check((await api(cu3, 'GET', '/api/c/me')).debt === 8000, "olmagan mijozga 8 000 qarz (kuryer haqi fonddan to'langan)");
    const q = await api(cu3, 'POST', '/api/c/quote', { place: code, items: [{ product_id: osh.id, qty: 2 }] });
    check(q.debt === 8000 && q.total === 86000 && q.policy.type === 'full' && /qarz/.test(q.policy.reason), "keyingi buyurtmaga qarz qo'shildi: 70 000 + 8 000 + 8 000, to'liq oldindan");
    const o4 = await order(cu3);
    check((await api(cu3, 'GET', '/api/c/me')).debt === 0 && (await api(plat, 'GET', '/api/platform/fund')).balance === fund0 + 8000, "to'lovdan keyin qarz yopildi va fondga qaytdi");
    const board = await api(kas, 'GET', '/api/delivery/orders');
    check(board.find((o) => o.id === o4)?.risk?.some((r) => /olmagan/.test(r)), "restoran doskasida mijoz xavfi ko'rinadi");
    await accept(o4);
    check((await deliver(o4, cu3)).ok, "o4: qarz bilan to'langan buyurtma yetkazildi");
    check((await api(kas, 'GET', '/api/shift')).byMethod.onlayn === 140000, "restoran chekida qarz yo'q — faqat taom (2 × 70 000 onlayn)");

    // ---------- 3. Hisob-kitob akti ----------
    let st = await api(plat, 'GET', '/api/platform/settle');
    let biz = st.businesses.find((b) => b.id === 1);
    // o1: 70000−8400 = 61600; o2: 78000−8400−78000 = −8400; o3: 0; o4: 61600 → 114800
    check(biz && biz.orders === 4 && biz.commission === 25200 && biz.own_cash === 78000 && biz.payable === 114800, `restoranga to'lanadi: 114 800 (${biz?.payable})`);
    const act = await api(plat, 'POST', '/api/platform/settle/1', { date_to: ymd() });
    check(act.payable === 114800 && act.lines.length === 4 && act.status === 'open', 'akt yaratildi (4 buyurtma)');
    check((await api(plat, 'POST', '/api/platform/settle/1', { date_to: ymd() }))._s === 409, "bir buyurtma ikki aktga tushmaydi");
    const pos = await api(adm, 'GET', '/api/delivery/settlements');
    check(pos.acts.length === 1 && pos.acts[0].payable === 114800 && pos.unsettled.orders === 0, "restoran (POS) aktini ko'radi");
    check((await api(kas, 'GET', '/api/delivery/settlements'))._s === 403, "kassir hisob-kitobni ko'rmaydi");
    check((await api(plat, 'POST', `/api/platform/settlements/${act.id}/paid`, { method: "o'tkazma" })).status === 'paid', "akt to'landi deb belgilandi");
    check((await api(plat, 'POST', `/api/platform/settlements/${act.id}/cancel`))._s === 409, "to'langan aktni bekor qilib bo'lmaydi");

    // ---------- 4. Mijoz shikoyati → restoran aybdor → kompensatsiya + undirish → e'tiroz ----------
    let co1 = await api(cu, 'GET', `/api/c/orders/${o1}`);
    check(co1.can_claim && !co1.claim, "yetkazilgan buyurtmaga shikoyat qilish mumkin");
    check((await api(cu, 'POST', `/api/c/orders/${o1}/claim`, { category: 'xyz', text: 'a' }))._s === 400, "noto'g'ri tur rad etildi");
    const cl = await api(cu, 'POST', `/api/c/orders/${o1}/claim`, { category: 'missing', text: 'Bitta osh kelmadi', amount: 35000, photo: IMG });
    check(cl.status === 'open' && cl.notes.length === 1, 'mijoz rasm bilan shikoyat qildi');
    check((await api(cu, 'POST', `/api/c/orders/${o1}/claim`, { category: 'missing', text: 'yana' }))._s === 409, 'bitta buyurtmaga bitta shikoyat');
    check((await api(cu2, 'POST', `/api/c/orders/${o1}/claim`, { category: 'missing', text: 'x' }))._s === 404, "boshqa mijoz buyurtmasiga shikoyat qilib bo'lmaydi");
    const rd = await api(adm, 'GET', '/api/delivery/disputes');
    check(rd.length === 1 && rd[0].category === 'missing', "restoran shikoyatni ko'rdi");
    await api(adm, 'POST', `/api/delivery/disputes/${cl.id}/note`, { text: 'Paketga 2 ta osh solingan', photo: IMG });
    const det = await api(plat, 'GET', `/api/platform/disputes/${cl.id}`);
    check(det.photos.some((p) => p.kind === 'seal') && det.notes.length === 2 && det.timeline.length >= 5 && det.order.items.length, "platforma isbotlarni ko'radi: plomba rasmi, izohlar, vaqt chizig'i");
    check((await api(plat, 'POST', `/api/platform/disputes/${cl.id}/resolve`, { guilty: 'customer', recover: 1000, note: 'x' }))._s === 400, "mijozdan undirib bo'lmaydi");
    let fund1 = (await api(plat, 'GET', '/api/platform/fund')).balance;
    const res = await api(plat, 'POST', `/api/platform/disputes/${cl.id}/resolve`, { guilty: 'restaurant', compensation: 35000, recover: 35000, note: "Restoran bitta oshni solmagan" });
    check(res.status === 'resolved' && res.compensation === 35000, 'nizo hal qilindi: restoran aybdor');
    check((await api(plat, 'GET', '/api/platform/fund')).balance === fund1, "fond: kompensatsiya chiqdi, restorandan undirilgan qaytdi");
    let ref = await api(plat, 'GET', '/api/platform/refunds');
    check(ref.pending.some((r) => r.dispute_id === cl.id && r.amount === 35000), "mijozga 35 000 qaytarish ro'yxatga tushdi");
    biz = (await api(plat, 'GET', '/api/platform/settle')).businesses.find((b) => b.id === 1);
    check(biz.adjustments === -35000 && biz.payable === -35000, 'keyingi aktda restorandan 35 000 ushlanadi');
    co1 = await api(cu, 'GET', `/api/c/orders/${o1}`);
    check(co1.claim.status === 'resolved' && co1.claim.compensation === 35000 && !co1.can_claim, "mijoz qarorni ko'rdi");
    check((await api(cu, 'POST', `/api/c/claims/${cl.id}/note`, { text: 'rahmat' }))._s === 409, "yopilgan nizoga yozib bo'lmaydi");
    const ap = await api(adm, 'POST', `/api/delivery/disputes/${cl.id}/appeal`, { text: "Kamerada 2 ta osh solingani ko'rinadi" });
    check(ap.appeal_status === 'open', "restoran e'tiroz bildirdi");
    check((await api(adm, 'POST', `/api/delivery/disputes/${cl.id}/appeal`, { text: 'yana' }))._s === 409, "e'tiroz bir marta");
    check((await api(plat, 'GET', '/api/platform/disputes')).some((d) => d.id === cl.id), "ochiq e'tiroz platforma ro'yxatida");
    await api(plat, 'POST', `/api/platform/disputes/${cl.id}/appeal`, { accept: true, note: 'Video isbot qabul qilindi' });
    biz = (await api(plat, 'GET', '/api/platform/settle')).businesses.find((b) => b.id === 1);
    check(biz.adjustments === 0 && (await api(plat, 'GET', '/api/platform/fund')).balance === fund1 - 35000, "e'tiroz qabul qilindi: undirish qaytarildi, kompensatsiya fond hisobidan qoldi");
    ref = await api(plat, 'GET', '/api/platform/refunds');
    const r1 = ref.pending.find((r) => r.dispute_id === cl.id);
    check((await api(plat, 'POST', `/api/platform/refunds/${r1.id}/done`, { method: 'payme', note: 'kabinetdan' })).ok && (await api(plat, 'GET', '/api/platform/refunds')).pending.length === 0, "kompensatsiya mijozga qaytarildi deb belgilandi");

    // ---------- 5. Kuryerga bosqichli choralar ----------
    const kd = (oid, cat) => api(adm, 'POST', '/api/delivery/disputes', { order_id: oid, against: 'courier', category: cat, text: 'Kuryer kech keldi va qo\'pol gapirdi' });
    check((await api(adm, 'POST', '/api/delivery/disputes', { order_id: o2, against: 'courier', category: 'rude', text: 'x' }))._s === 400, "kuryersiz buyurtmada kuryerga shikoyat bo'lmaydi");
    const d1 = await kd(o1, 'rude'), d2 = await kd(o3, 'rude'), d3 = await kd(o4, 'late');
    check(d1.id && d2.id && d3.id, 'restoran kuryerga 3 ta shikoyat yozdi');
    const sug = await api(plat, 'GET', `/api/platform/disputes/${d1.id}`);
    check(sug.suggest_measure === 'warn' && sug.courier?.name === 'Ali Valiyev', 'birinchi ayb — ogohlantirish taklif qilinadi');
    check((await api(plat, 'POST', `/api/platform/disputes/${d1.id}/resolve`, { guilty: 'courier', measure: 'auto', note: 'Ogohlantirildi' })).measure === 'warn', '1-ayb → ogohlantirish');
    let bal0 = (await api(k1, 'GET', '/api/k/state')).me.balance;
    const r2 = await api(plat, 'POST', `/api/platform/disputes/${d2.id}/resolve`, { guilty: 'courier', measure: 'auto', note: 'Takror' });
    check(r2.measure === 'fine' && r2.measure_amount === 20000 && (await api(k1, 'GET', '/api/k/state')).me.balance === bal0 - 20000, '2-ayb → 20 000 jarima');
    check((await api(plat, 'POST', `/api/platform/disputes/${d3.id}/resolve`, { guilty: 'courier', measure: 'auto', note: 'Uchinchi' })).measure === 'block', '3-ayb → blok');
    let me = (await api(k1, 'GET', '/api/k/state')).me;
    check(me.status === 'blocked' && /Nizo/.test(me.status_reason), 'kuryer bloklandi');
    const kl = await api(k1, 'GET', '/api/k/disputes');
    check(kl.length === 4 && kl.filter((d) => d.guilty === 'courier').length === 3 && kl.filter((d) => d.can_appeal).length === 3, "kuryer o'z nizolarini va e'tiroz huquqini ko'radi");
    check((await api(k1, 'POST', `/api/k/disputes/${d2.id}/appeal`, { text: "Restoran 40 daqiqa kechiktirgan, men aybdor emasman" })).appeal_status === 'open', "kuryer jarimaga e'tiroz bildirdi");
    await api(plat, 'POST', `/api/platform/disputes/${d2.id}/appeal`, { accept: true, note: "Restoran kechiktirgani tasdiqlandi" });
    check((await api(k1, 'GET', '/api/k/state')).me.balance === bal0, "e'tiroz qabul qilindi → jarima qaytarildi");
    check((await api(k1, 'POST', `/api/k/disputes/${d3.id}/appeal`, { text: 'Blokni olib tashlang' })).appeal_status === 'open', "kuryer blokka e'tiroz bildirdi");
    await api(plat, 'POST', `/api/platform/disputes/${d3.id}/appeal`, { accept: false, note: 'Rad etildi' });
    check((await api(k1, 'GET', '/api/k/state')).me.status === 'blocked', "e'tiroz rad etildi → blok qoladi");
    const ba = await api(k1, 'POST', '/api/k/disputes', { category: 'block_appeal', text: "Qoidalarni qayta o'qidim, imkon bering" });
    check(ba.status === 'open' && (await api(k1, 'POST', '/api/k/disputes', { category: 'block_appeal', text: 'x' }))._s === 409, "blokdan e'tiroz arizasi (bittadan)");
    await api(plat, 'POST', `/api/platform/disputes/${ba.id}/resolve`, { guilty: 'none', measure: 'unblock', note: 'Oxirgi imkoniyat' });
    check((await api(k1, 'GET', '/api/k/state')).me.status === 'probation', 'platforma blokdan chiqardi');

    // ---------- 6. Asossiz shikoyatlar → avtomatik qora ro'yxat ----------
    const cu4 = await cust('977009900');
    const uid = db.prepare("SELECT id FROM app_users WHERE phone='998977009900'").get().id;
    for (let i = 0; i < 3; i++) {
      const id = Number(db.prepare(`INSERT INTO delivery_orders (business_id,app_user_id,phone,items,subtotal,delivery_fee,total,status,created_at,updated_at,delivered_at) VALUES (1,?,'998977009900','[]',50000,8000,58000,'delivered',?,?,?)`).run(uid, new Date().toISOString(), new Date().toISOString(), new Date().toISOString()).lastInsertRowid);
      const c = await api(cu4, 'POST', `/api/c/orders/${id}/claim`, { category: 'not_delivered', text: 'Kelmadi', amount: 58000 });
      if (i === 2) check((await api(plat, 'GET', '/api/platform/disputes')).find((d) => d.id === c.id)?.risk.some((r) => /asossiz/.test(r)), "takroriy shikoyatchi xavfli deb belgilangan");
      const rr = await api(plat, 'POST', `/api/platform/disputes/${c.id}/resolve`, { guilty: 'customer', note: "Kod bilan topshirilgan — asossiz" });
      if (i === 0) check(rr.status === 'resolved' && rr.guilty === 'customer', 'asossiz shikoyat — mijoz aybdor');
    }
    check([401, 403].includes((await api(cu4, 'GET', '/api/c/me'))._s), "3 ta asossiz shikoyat → mijoz bloklandi");
    check((await api(null, 'POST', '/api/c/otp', { phone: '977009900' }))._s === 403, "qora ro'yxatdagi raqamga SMS ham yuborilmaydi");
    let risk = await api(plat, 'GET', '/api/platform/risk');
    check(risk.blacklist.some((b) => b.phone === '998977009900') && risk.customers.some((c) => c.phone === '998977005566'), "qora ro'yxat va xavfli mijozlar ko'rinadi");
    await api(plat, 'POST', `/api/platform/blacklist/${risk.blacklist.find((b) => b.phone === '998977009900').id}/remove`);
    check((await api(null, 'POST', '/api/c/otp', { phone: '977009900' })).ok, "qora ro'yxatdan chiqarildi → kira oladi");
    check((await api(plat, 'POST', '/api/platform/blacklist', { phone: '935550001', kind: 'courier', reason: 'Firibgarlik' })).ok, "kuryer qora ro'yxatga qo'shildi");
    check((await api(null, 'POST', '/api/k/otp', { phone: '935550001' }))._s === 403 && (await api(k1, 'GET', '/api/k/state')).me === undefined, "kuryer chiqarildi va qayta kira olmaydi");

    // ---------- 7. Qaytarish: rad etilgan oldindan to'langan buyurtma ----------
    await api(adm, 'POST', '/api/delivery/settings', { prepay_mode: 'full' });
    const o5 = await order(cu2);
    await api(kas, 'POST', `/api/delivery/orders/${o5}/reject`, { reason: 'Taom tugagan' });
    ref = await api(plat, 'GET', '/api/platform/refunds');
    check(ref.orders.some((o) => o.id === o5 && o.amount === 78000), "rad etilgan buyurtma: 78 000 qaytarish kutilmoqda");
    await api(plat, 'POST', `/api/platform/refunds/order/${o5}`, { method: 'click' });
    check((await api(cu2, 'GET', `/api/c/orders/${o5}`)).payment_status === 'refunded', "qaytarildi → mijoz 'To'lov qaytarildi' ni ko'radi");

    // ---------- 8. Statistika va jurnal ----------
    const s = await api(plat, 'GET', `/api/platform/stats?from=${ymd(-1)}&to=${ymd()}`);
    check(s.totals.delivered >= 3 && s.totals.no_show === 1 && s.totals.rejected === 1 && s.totals.commission >= 25200, `statistika: yetkazildi ${s.totals.delivered}, olinmadi 1, rad 1`);
    check(s.totals.gmv >= 234000 && s.totals.avg_total_min != null && s.businesses[0].name && s.couriers[0].delivered === 2, "GMV, o'rtacha vaqt, bizneslar va kuryerlar samaradorligi");
    check(s.days.length >= 1, 'kunlar kesimi');
    const lg = await api(plat, 'GET', '/api/platform/log');
    check(['settlement_create', 'dispute_resolve', 'appeal_decide', 'blacklist_add', 'refund_order'].every((a) => lg.some((x) => x.action === a)), 'platforma jurnaliga yozildi');
    check((await api(null, 'GET', '/api/platform/stats?from=2026-01-01&to=2026-01-02'))._s === 401, "parolsiz platforma ma'lumoti berilmaydi");
  } catch (e) { console.error(e); bad++; }
  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  proc.kill(); process.exit(bad ? 1 : 0);
})();
