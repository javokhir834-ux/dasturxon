// 6-etap testi: mijoz ilovasi API, to'lov qoidalari, POS oqimi; Payme va Click callbacklari.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const APP = require('path').join(__dirname, '..', 'src', 'server.ts'), B = 'http://127.0.0.1:8080';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(t, method, path, body, headers = {}) {
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { _s: r.status }) : { ...j, _s: r.status };
}
let proc;
async function start(env) { proc?.kill(); await wait(400); fs.rmSync('/tmp/dlv', { recursive: true, force: true }); proc = spawn('node', [APP], { env: { ...process.env, DATA_DIR: '/tmp/dlv', PLATFORM_PASSWORD: 'pp-123456', ...env }, stdio: 'ignore' }); await wait(1400); }
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function setup(phoneSuffix) {
  const reg = await api(null, 'POST', '/api/register', { business_name: 'Bahor', owner_name: 'Sardor', phone: '9010000' + phoneSuffix, password: 'parol123', admin_pin: '1234', sample: true });
  const plat = (await api(null, 'POST', '/api/platform/login', { password: 'pp-123456' })).token;
  await api(plat, 'POST', `/api/platform/businesses/${reg.business_id}/subscription`, { product: 'delivery', enabled: true, paid_until: ymd(30) });
  const adm = (await api(null, 'POST', '/api/login', { code: reg.code, pin: '1234' })).token;
  await api(adm, 'POST', '/api/admin/users', { name: 'Kassir', role: 'kassir', pin: '2222' });
  await api(adm, 'POST', '/api/admin/users', { name: 'Oshpaz', role: 'oshpaz', pin: '4444' });
  const kas = (await api(null, 'POST', '/api/login', { code: reg.code, pin: '2222' })).token;
  const cook = (await api(null, 'POST', '/api/login', { code: reg.code, pin: '4444' })).token;
  const boot = await api(adm, 'GET', '/api/bootstrap');
  const P = (n) => boot.products.find((p) => p.name === n);
  return { reg, plat, adm, kas, cook, boot, P };
}
async function customer(phone, name) {
  const otp = await api(null, 'POST', '/api/c/otp', { phone });
  return (await api(null, 'POST', '/api/c/login', { phone, code: otp.dev_code, name })).token;
}

(async () => {
  // ================= A: sinov to'lovi bilan to'liq oqim =================
  await start({});
  const { reg, plat, adm, kas, cook, P } = await setup('01');
  const set = await api(adm, 'POST', '/api/delivery/settings', { enabled: true, open: true, place_type: 'kafe', address: 'Navoiy, Halqobod 5', min_order: 20000, delivery_fee: 10000, prepay_mode: 'mixed', cash_limit: 300000, trusted_after: 2, expensive_limit: 200000 });
  check(set._s === 200 && set.enabled === 1, 'restoran yetkazib berishni yoqdi');
  await api(adm, 'POST', '/api/admin/products', { id: P('Non').id, delivery: false });
  await api(adm, 'POST', '/api/admin/products', { id: P('Shashlik').id, non_returnable: true });
  const places = await api(null, 'GET', '/api/c/places');
  check(places.length === 1 && places[0].open && places[0].type === 'kafe', "mijoz ilovasida joy ko'rinadi");
  const menu = await api(null, 'GET', `/api/c/places/${reg.code}`);
  check(!menu.products.some((x) => x.name === 'Non') && menu.products.some((x) => x.name === 'Osh'), "yetkazib berishda yo'q taom menyuda ko'rinmaydi");

  check((await api(null, 'POST', '/api/c/login', { phone: '911112233', code: '00000' }))._s === 400, "kodsiz/noto'g'ri kod rad etildi");
  const otp = await api(null, 'POST', '/api/c/otp', { phone: '91 111 22 33' });
  check((await api(null, 'POST', '/api/c/otp', { phone: '911112233' }))._s === 429, 'SMS kod qayta so\'rash 1 daqiqaga cheklangan');
  check((await api(null, 'POST', '/api/c/login', { phone: '911112233', code: '11111' }))._s === 400, "noto'g'ri kod rad etildi");
  const cu = (await api(null, 'POST', '/api/c/login', { phone: '911112233', code: otp.dev_code, name: 'Dilshod' })).token;
  check(!!cu, 'mijoz SMS kod bilan kirdi');

  const cart = (extra = []) => [{ product_id: P('Osh').id, qty: 2, price: 1 }, ...extra];
  let q = await api(cu, 'POST', '/api/c/quote', { place: reg.code, items: cart() });
  check(q.subtotal === 70000 && q.total === 80000 && q.policy.type === 'full' && q.policy.prepay_amount === 80000, "yangi mijoz: to'liq oldindan (narx serverdan, 'price' e'tiborsiz)");
  check((await api(cu, 'POST', '/api/c/orders', { place: reg.code, items: [{ product_id: P('Somsa').id, qty: 1 }], address: 'x', provider: 'test' }))._s === 400, 'minimal buyurtmadan kam rad etildi');

  async function fullCycle(provider = 'test', items = cart()) {
    const r = await api(cu, 'POST', '/api/c/orders', { place: reg.code, items, address: 'Navoiy, Navoiy ko\'chasi 12, 3-xonadon', provider, note: 'Domofon 12' });
    if (r.order.status === 'awaiting_payment') await api(cu, 'POST', `/api/c/orders/${r.order.id}/test-pay`);
    return r;
  }
  const r1 = await api(cu, 'POST', '/api/c/orders', { place: reg.code, items: cart(), address: 'Navoiy, 12-uy', provider: 'test' });
  check(r1.order.status === 'awaiting_payment' && r1.pay_url === `/app/#pay/${r1.order.id}`, "buyurtma to'lov kutmoqda, sinov to'lov sahifasi");
  check((await api(kas, 'GET', '/api/delivery/orders')).length === 0, "to'lanmagan buyurtma restoranga ko'rinmaydi");
  const paid = await api(cu, 'POST', `/api/c/orders/${r1.order.id}/test-pay`);
  check(paid.status === 'new' && paid.payment_status === 'paid' && paid.paid_amount === 80000, "to'landi → restoranga tushdi");
  check((await api(kas, 'POST', `/api/delivery/orders/${r1.order.id}/accept`, { prep_minutes: 25 }))._s === 409, 'smenasiz qabul qilib bo\'lmaydi');
  await api(kas, 'POST', '/api/shift/open', { opening_cash: 0 });
  const acc = await api(kas, 'POST', `/api/delivery/orders/${r1.order.id}/accept`, { prep_minutes: 25 });
  check(acc.status === 'accepted' && acc.pos_order_id && acc.prep_minutes === 25, 'restoran qabul qildi → POS buyurtma ochildi');
  const kit = await api(cook, 'GET', '/api/kitchen');
  check(kit.length === 1 && kit[0].delivery_id === r1.order.id && kit[0].qty === 2, "oshxona ekranida 🛵 yetkazib berish taomi");
  check((await api(cu, 'POST', `/api/c/orders/${r1.order.id}/cancel`))._s === 409, "qabul qilingandan keyin mijoz bekor qila olmaydi");
  await api(cook, 'POST', `/api/items/${kit[0].id}/status`, { status: 'ready' });
  await wait(200);
  check((await api(cu, 'GET', `/api/c/orders/${r1.order.id}`)).status === 'ready', 'oshxona tayyor qildi → mijozga "tayyor"');
  await api(kas, 'POST', `/api/delivery/orders/${r1.order.id}/dispatch`);
  const del = await api(kas, 'POST', `/api/delivery/orders/${r1.order.id}/delivered`);
  const po = await api(kas, 'GET', `/api/orders/${acc.pos_order_id}`);
  check(del.status === 'delivered' && po.status === 'closed' && po.payments[0].method === 'onlayn' && po.payments[0].amount === 70000, "yetkazildi → POS chek yopildi (onlayn 70 000, yetkazish haqi restoranga emas)");
  check(del.commission === 8400, 'komissiya 12%: 8 400');

  // 2-buyurtma → ishonchli mijoz
  let r2 = await fullCycle();
  await api(kas, 'POST', `/api/delivery/orders/${r2.order.id}/accept`); await api(kas, 'POST', `/api/delivery/orders/${r2.order.id}/delivered`);
  q = await api(cu, 'POST', '/api/c/quote', { place: reg.code, items: cart() });
  check(q.policy.type === 'cash' && q.policy.prepay_amount === 0, "2 ta muvaffaqiyatli buyurtmadan keyin naqd ochildi");
  const r3 = await api(cu, 'POST', '/api/c/orders', { place: reg.code, items: cart(), address: 'Navoiy', provider: 'cash' });
  check(r3.order.status === 'new' && r3.pay_url === null, "naqd buyurtma to'g'ridan-to'g'ri restoranga");
  const a3 = await api(kas, 'POST', `/api/delivery/orders/${r3.order.id}/accept`); await api(kas, 'POST', `/api/delivery/orders/${r3.order.id}/delivered`);
  check((await api(kas, 'GET', `/api/orders/${a3.pos_order_id}`)).payments[0].method === 'naqd', 'naqd buyurtma POSda naqd yopildi');
  q = await api(cu, 'POST', '/api/c/quote', { place: reg.code, items: [{ product_id: P('Shashlik').id, qty: 12 }] });
  check(q.policy.type === 'full' && /qimmat/.test(q.policy.reason), "qaytarilmaydigan qimmat buyurtma → to'liq oldindan");
  await api(adm, 'POST', '/api/delivery/settings', { partial_percent: 30 });
  q = await api(cu, 'POST', '/api/c/quote', { place: reg.code, items: cart() });
  check(q.policy.type === 'partial' && q.policy.prepay_amount === 24000 && q.policy.cash_amount === 56000, "qisman: 30% oldindan (24 000), qolgani naqd");
  await api(adm, 'POST', '/api/delivery/settings', { partial_percent: 0, prepay_mode: 'full' });
  check((await api(cu, 'POST', '/api/c/quote', { place: reg.code, items: cart() })).policy.type === 'full', "restoran 'faqat oldindan' rejimi");
  await api(adm, 'POST', '/api/delivery/settings', { prepay_mode: 'mixed' });

  // Kelmadi → keyingi safar to'liq oldindan
  const r5 = await api(cu, 'POST', '/api/c/orders', { place: reg.code, items: cart(), address: 'Navoiy', provider: 'cash' });
  const a5 = await api(kas, 'POST', `/api/delivery/orders/${r5.order.id}/accept`);
  const ns = await api(kas, 'POST', `/api/delivery/orders/${r5.order.id}/no_show`);
  check(ns.status === 'no_show' && (await api(kas, 'GET', `/api/orders/${a5.pos_order_id}`)).status === 'cancelled', 'mijoz olmadi → POS chek bekor, masalliq hisobdan chiqdi');
  check((await api(cu, 'POST', '/api/c/quote', { place: reg.code, items: cart() })).policy.type === 'full', "olmagan mijozga endi faqat oldindan to'lov");
  // Rad etish va mijoz bekor qilishi
  const r6 = await fullCycle();
  const rj = await api(kas, 'POST', `/api/delivery/orders/${r6.order.id}/reject`, { reason: 'Masalliq tugadi' });
  check(rj.status === 'rejected' && rj.payment_status === 'refund_due', "to'langan buyurtma rad etildi → pul qaytarish kerak deb belgilandi");
  const r7 = await fullCycle();
  const c7 = await api(cu, 'POST', `/api/c/orders/${r7.order.id}/cancel`);
  check(c7.status === 'cancelled' && c7.payment_status === 'refund_due', 'mijoz qabul qilinmagan buyurtmani bekor qildi');
  // Stop-list, yopiq
  await api(kas, 'POST', `/api/products/${P('Osh').id}/stop`, { in_stop: true });
  check((await api(cu, 'POST', '/api/c/quote', { place: reg.code, items: cart() }))._s === 409, 'stop-listdagi taom rad etildi');
  await api(kas, 'POST', `/api/products/${P('Osh').id}/stop`, { in_stop: false });
  await api(adm, 'POST', '/api/delivery/settings', { open: false });
  check((await api(cu, 'POST', '/api/c/orders', { place: reg.code, items: cart(), address: 'x', provider: 'test' }))._s === 409 && !(await api(null, 'GET', '/api/c/places'))[0].open, "yopiq joy buyurtma qabul qilmaydi");
  await api(adm, 'POST', '/api/delivery/settings', { open: true });
  await api(plat, 'POST', `/api/platform/businesses/${reg.business_id}/subscription`, { product: 'delivery', paid_until: ymd(-10) });
  check((await api(null, 'GET', '/api/c/places')).length === 0, "yetkazib berish obunasi tugasa — ilovadan yo'qoladi");
  check((await api(cu, 'GET', '/api/c/orders')).length === 6, 'mijoz buyurtmalar tarixi');
  const rep = await api(adm, 'GET', `/api/delivery/report?from=${ymd(0)}&to=${ymd(0)}`);
  check(rep.rows.find((r) => r.status === 'delivered').c === 3, 'yetkazib berish hisoboti');

  // ================= B: Payme va Click =================
  await start({ PAYME_MERCHANT_ID: 'm-test', PAYME_KEY: 'payme-key', CLICK_SERVICE_ID: '111', CLICK_MERCHANT_ID: '222', CLICK_SECRET_KEY: 'click-secret' });
  const s2 = await setup('02');
  await api(s2.adm, 'POST', '/api/delivery/settings', { enabled: true, min_order: 0, delivery_fee: 5000 });
  await api(s2.kas, 'POST', '/api/shift/open', { opening_cash: 0 });
  const cu2 = await customer('931234567', 'Aziz');
  const ord = async (provider) => (await api(cu2, 'POST', '/api/c/orders', { place: s2.reg.code, items: [{ product_id: s2.P('Osh').id, qty: 1 }], address: 'Navoiy', provider }));
  check((await api(cu2, 'POST', '/api/c/orders', { place: s2.reg.code, items: [{ product_id: s2.P('Osh').id }], address: 'x', provider: 'test' }))._s === 400, "kalitlar bor — sinov to'lovi o'chiq");
  const o1 = await ord('payme');
  const pm = Buffer.from(o1.pay_url.split('/').pop(), 'base64').toString();
  check(o1.pay_url.startsWith('https://checkout.paycom.uz/') && pm === `m=m-test;ac.order_id=${o1.order.id};a=4000000;c=/app/#order/${o1.order.id}`, 'Payme checkout havolasi (tiyinda: 4 000 000)');
  const AUTH = { Authorization: 'Basic ' + Buffer.from('Paycom:payme-key').toString('base64') };
  const rpc = async (method, params, h = AUTH) => (await fetch(B + '/api/pay/payme', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ id: 1, method, params }) })).json();
  check((await rpc('CheckPerformTransaction', {}, { Authorization: 'Basic ' + Buffer.from('Paycom:xato').toString('base64') })).error.code === -32504, "Payme: noto'g'ri kalit → -32504");
  check((await rpc('CheckPerformTransaction', { amount: 100, account: { order_id: o1.order.id } })).error.code === -31001, "Payme: noto'g'ri summa → -31001");
  check((await rpc('CheckPerformTransaction', { amount: 4000000, account: { order_id: 99999 } })).error.code === -31050, 'Payme: buyurtma yo\'q → -31050');
  check((await rpc('CheckPerformTransaction', { amount: 4000000, account: { order_id: o1.order.id } })).result.allow === true, 'Payme: CheckPerformTransaction → allow');
  const ct = await rpc('CreateTransaction', { id: 'pm-1', time: Date.now(), amount: 4000000, account: { order_id: o1.order.id } });
  const ct2 = await rpc('CreateTransaction', { id: 'pm-1', time: Date.now(), amount: 4000000, account: { order_id: o1.order.id } });
  check(ct.result.state === 1 && ct2.result.transaction === ct.result.transaction && ct2.result.create_time === ct.result.create_time, 'Payme: CreateTransaction idempotent');
  check((await rpc('CreateTransaction', { id: 'pm-2', time: Date.now(), amount: 4000000, account: { order_id: o1.order.id } })).error.code === -31050, 'Payme: ikkinchi tranzaksiya band → -31050');
  check((await rpc('PerformTransaction', { id: 'yoq' })).error.code === -31003, 'Payme: tranzaksiya yo\'q → -31003');
  const pf = await rpc('PerformTransaction', { id: 'pm-1' }), pf2 = await rpc('PerformTransaction', { id: 'pm-1' });
  const o1s = await api(cu2, 'GET', `/api/c/orders/${o1.order.id}`);
  check(pf.result.state === 2 && pf2.result.perform_time === pf.result.perform_time && o1s.status === 'new' && o1s.payment_status === 'paid', "Payme: PerformTransaction → to'landi, takrori o'sha natija");
  check((await rpc('CheckTransaction', { id: 'pm-1' })).result.state === 2, 'Payme: CheckTransaction');
  const cn = await rpc('CancelTransaction', { id: 'pm-1', reason: 5 });
  const o1c = await api(cu2, 'GET', `/api/c/orders/${o1.order.id}`);
  check(cn.result.state === -2 && o1c.status === 'cancelled' && o1c.payment_status === 'refunded', "Payme: to'lovdan keyin bekor (restoran hali qabul qilmagan) → -2, pul qaytarildi");
  const o2 = await ord('payme');
  await rpc('CreateTransaction', { id: 'pm-3', time: Date.now(), amount: 4000000, account: { order_id: o2.order.id } }); await rpc('PerformTransaction', { id: 'pm-3' });
  await api(s2.kas, 'POST', `/api/delivery/orders/${o2.order.id}/accept`);
  check((await rpc('CancelTransaction', { id: 'pm-3', reason: 5 })).error.code === -31007, "Payme: restoran tayyorlayotgan buyurtmani bekor qilib bo'lmaydi → -31007");
  const st = await rpc('GetStatement', { from: Date.now() - 60000, to: Date.now() + 1000 });
  check(st.result.transactions.length === 2 && (await rpc('Nimadir', {})).error.code === -32601, 'Payme: GetStatement, noma\'lum usul → -32601');

  const o3 = await ord('click');
  check(o3.pay_url.startsWith('https://my.click.uz/services/pay?service_id=111&merchant_id=222&amount=40000&transaction_param=' + o3.order.id), 'Click to\'lov havolasi');
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const click = async (path, f) => (await fetch(B + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(f).toString() })).json();
  const prep = (oid, amount, sign) => { const f = { click_trans_id: 'c' + oid, service_id: '111', click_paydoc_id: '9', merchant_trans_id: String(oid), amount: String(amount), action: '0', error: '0', error_note: 'ok', sign_time: '2026-11-24 21:00:00' };
    f.sign_string = sign || md5(f.click_trans_id + f.service_id + 'click-secret' + f.merchant_trans_id + f.amount + f.action + f.sign_time); return f; };
  const comp = (oid, amount, prepareId, error = '0') => { const f = { click_trans_id: 'c' + oid, service_id: '111', click_paydoc_id: '9', merchant_trans_id: String(oid), merchant_prepare_id: String(prepareId), amount: String(amount), action: '1', error, error_note: 'ok', sign_time: '2026-11-24 21:00:05' };
    f.sign_string = md5(f.click_trans_id + f.service_id + 'click-secret' + f.merchant_trans_id + f.merchant_prepare_id + f.amount + f.action + f.sign_time); return f; };
  check((await click('/api/pay/click/prepare', prep(o3.order.id, '40000.00', 'a'.repeat(32)))).error === -1, "Click: noto'g'ri imzo → -1");
  check((await click('/api/pay/click/prepare', prep(o3.order.id, '100.00'))).error === -2, "Click: noto'g'ri summa → -2");
  const pr = await click('/api/pay/click/prepare', prep(o3.order.id, '40000.00'));
  check(pr.error === 0 && pr.merchant_prepare_id, 'Click: Prepare → merchant_prepare_id');
  check((await click('/api/pay/click/complete', comp(o3.order.id, '40000.00', 999))).error === -6, "Click: noto'g'ri prepare_id → -6");
  const cm = await click('/api/pay/click/complete', comp(o3.order.id, '40000.00', pr.merchant_prepare_id));
  const cm2 = await click('/api/pay/click/complete', comp(o3.order.id, '40000.00', pr.merchant_prepare_id));
  check(cm.error === 0 && cm2.error === -4 && (await api(cu2, 'GET', `/api/c/orders/${o3.order.id}`)).status === 'new', "Click: Complete → to'landi, takrori → -4 (allaqachon to'langan)");
  const o4 = await ord('click');
  const pr4 = await click('/api/pay/click/prepare', prep(o4.order.id, '40000.00'));
  const cm4 = await click('/api/pay/click/complete', comp(o4.order.id, '40000.00', pr4.merchant_prepare_id, '-5017'));
  check(cm4.error === -9 && (await api(cu2, 'GET', `/api/c/orders/${o4.order.id}`)).status === 'cancelled', "Click: to'lov muvaffaqiyatsiz (error<0) → buyurtma bekor");

  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  proc.kill(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); proc?.kill(); process.exit(1); });
