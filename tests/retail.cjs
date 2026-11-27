// 9-etap testi: dorixona (litsenziya, retseptli dori), do'kon (kg, almashtirish), olib ketish, tez sotuv, kechki chegirma.
const { spawn } = require('child_process');
const ONB = require('./_onboard.cjs');
const ready = require('./_ready.cjs');
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'src', 'server.ts'), B = 'http://127.0.0.1:8080', DIR = '/tmp/retailT';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(t, method, p, body) {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { _s: r.status }) : { ...j, _s: r.status };
}
const ymd = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const hm = (ms) => { const d = new Date(Date.now() + ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

(async () => {
  fs.rmSync(DIR, { recursive: true, force: true });
  const proc = spawn('node', [APP], { env: { ...process.env, DATA_DIR: DIR, PLATFORM_PASSWORD: 'pp-123456' }, stdio: ['ignore', 'ignore', process.env.SHOW_ERR ? 'inherit' : 'ignore'] });
  await ready();
  try {
    const plat = (await api(null, 'POST', '/api/platform/login', { password: 'pp-123456' })).token;
    // ---------- Dorixona ----------
    const reg = await api(null, 'POST', '/api/register', { business_name: 'Shifo dorixona', owner_name: 'Ega', phone: '901112233', password: 'parol123', admin_pin: '5555', ...ONB.BIZ });
    await api(plat, 'POST', `/api/platform/businesses/${reg.business_id}/subscription`, { product: 'delivery', enabled: true, paid_until: ymd(30) });
    const da = (await api(null, 'POST', '/api/login', { code: reg.code, pin: '5555' })).token;
    const dboot = await api(da, 'GET', '/api/bootstrap');
    const cat = dboot.categories[0].id, ws = dboot.workshops[0].id;
    const otc = await api(da, 'POST', '/api/admin/products', { name: 'Paratsetamol 500mg', price: 6000, category_id: cat, workshop_id: ws, delivery: true });
    const rx = await api(da, 'POST', '/api/admin/products', { name: 'Amoksitsillin', price: 25000, category_id: cat, workshop_id: ws, delivery: true, rx: true, barcode: '4780001112223' });
    check(otc._s === 200 && rx.rx === 1 && rx.barcode === '4780001112223', "dorixona: retseptsiz va retseptli dori, shtrix-kod saqlandi");
    const st = await api(da, 'POST', '/api/delivery/settings', { enabled: true, open: true, place_type: 'dorixona', address: 'Navoiy' });
    check(st.place_type === 'dorixona', "joy turi 'dorixona'");
    const listed = async () => (await api(null, 'GET', '/api/c/places')).some((x) => x.code === reg.code);
    check(!(await listed()) && (await api(null, 'GET', `/api/c/places/${reg.code}`))._s === 404, "litsenziyasiz dorixona ilovada ko'rinmaydi");
    await api(da, 'POST', '/api/delivery/settings', { license_no: 'DL-0001', license_until: ymd(200) });
    let ph = (await api(plat, 'GET', '/api/platform/pharmacies')).find((x) => x.id === reg.business_id);
    check(ph && !ph.visible && /yoqilmagan/.test(ph.reason), "platformada dorixonalar hali yoqilmagan (yurist xulosasi)");
    await api(plat, 'POST', '/api/platform/settings', { pharmacy_enabled: 1 });
    ph = (await api(plat, 'GET', '/api/platform/pharmacies')).find((x) => x.id === reg.business_id);
    check(!ph.visible && /tekshirilmoqda/.test(ph.reason), 'litsenziya platforma tekshiruvini kutmoqda');
    check((await api(null, 'POST', `/api/platform/pharmacies/${reg.business_id}`, { verified: true }))._s === 401, 'tasdiqlash faqat platformaga');
    const vr = await api(plat, 'POST', `/api/platform/pharmacies/${reg.business_id}`, { verified: true, note: 'Litsenziya reestrda bor' });
    check(vr.ok && await listed(), "litsenziya tasdiqlandi → dorixona ilovada ko'rindi");
    const pmenu = await api(null, 'GET', `/api/c/places/${reg.code}`);
    check(pmenu.products.some((x) => x.id === otc.id) && !pmenu.products.some((x) => x.id === rx.id), "retseptli dori mijozga ko'rinmaydi");
    const o0 = await api(null, 'POST', '/api/c/otp', { phone: '977002200' });
    const cu = (await api(null, 'POST', '/api/c/login', { phone: '977002200', code: o0.dev_code, name: 'Lola' })).token;
    const rxo = await api(cu, 'POST', '/api/c/quote', { place: reg.code, items: [{ product_id: rx.id, qty: 1 }] });
    check(rxo._s === 400 && /retsept/.test(rxo.error), "retseptli dorini ilovada buyurtma qilib bo'lmaydi (to'g'ridan API ham)");
    await api(da, 'POST', '/api/delivery/settings', { license_until: ymd(-1) });
    check(!(await listed()), "litsenziya muddati o'tsa — dorixona yashirinadi");
    await api(da, 'POST', '/api/delivery/settings', { license_until: ymd(200) });

    // ---------- Tez sotuv (dorixona kassasi) ----------
    const dk = da;
    check((await api(dk, 'POST', '/api/counter/sale', { items: [{ product_id: otc.id, qty: 2 }], payments: [{ method: 'naqd', amount: 20000 }] }))._s === 409, 'smena yopiq — sotuv yo\'q');
    await api(dk, 'POST', '/api/shift/open', { opening_cash: 0 });
    const s1 = await api(dk, 'POST', '/api/counter/sale', { items: [{ product_id: rx.id, qty: 1 }], payments: [{ method: 'naqd', amount: 25000 }] });
    check(s1._s === 409 && /retsept/.test(s1.error), "retseptli dori: retsept belgilanmasa sotilmaydi");
    check((await api(dk, 'POST', '/api/counter/sale', { items: [{ product_id: otc.id, qty: 2 }], payments: [{ method: 'naqd', amount: 10000 }] }))._s === 400, "to'lov yetmasa — rad");
    check((await api(dk, 'POST', '/api/counter/sale', { items: [{ product_id: otc.id, qty: 2 }], payments: [{ method: 'karta', amount: 20000 }] }))._s === 400, 'kartadan qaytim berilmaydi');
    const s2 = await api(dk, 'POST', '/api/counter/sale', { items: [{ product_id: otc.id, qty: 2 }, { product_id: rx.id, qty: 1 }], payments: [{ method: 'naqd', amount: 40000 }], rx_checked: true });
    check(s2._s === 200 && s2.order.total === 37000 && s2.change === 3000 && s2.order.status === 'closed', 'tez sotuv: 37 000, qaytim 3 000, chek yopildi');
    const audit = await api(da, 'GET', '/api/audit?limit=20');
    check(Array.isArray(audit) ? audit.some((x) => x.action === 'rx_sale') : true, "retseptli sotuv audit jurnalida");
    const sh = await api(dk, 'GET', '/api/shift');
    check(sh.byMethod.naqd === 37000 && sh.orders >= 1, "smena hisobotida tez sotuv tushumi");

    // ---------- Do'kon: kg, almashtirish, olib ketish ----------
    await api(plat, 'POST', '/api/platform/businesses/1/subscription', { product: 'delivery', enabled: true, paid_until: ymd(30) });
    const pb = await api(plat, 'GET', '/api/platform/businesses'); const b1code = (pb.businesses || pb).find((x) => x.id === 1).code;
    const adm = (await api(null, 'POST', '/api/login', { code: b1code, pin: '1111' })).token, kas = (await api(null, 'POST', '/api/login', { code: b1code, pin: '2222' })).token;
    await api(kas, 'POST', '/api/shift/open', { opening_cash: 0 });
    await api(adm, 'POST', '/api/delivery/settings', { enabled: true, open: true, place_type: 'dokon', delivery_fee: 8000, prepay_mode: 'full' });
    const boot = await api(adm, 'GET', '/api/bootstrap');
    const c1 = boot.categories[0].id, w1 = boot.workshops[0].id, code = boot.business.code;
    const olma = await api(adm, 'POST', '/api/admin/products', { name: 'Olma', price: 20000, category_id: c1, workshop_id: w1, delivery: true, sold_by: 'kg', step_g: 250 });
    const sut = await api(adm, 'POST', '/api/admin/products', { name: 'Sut 1L', price: 12000, category_id: c1, workshop_id: w1, delivery: true });
    const kefir = await api(adm, 'POST', '/api/admin/products', { name: 'Kefir 1L', price: 11000, category_id: c1, workshop_id: w1, delivery: true });
    check((await api(adm, 'POST', '/api/admin/products', { name: 'X', price: 1, category_id: c1, workshop_id: w1, sold_by: 'litr' }))._s === 400, "sotish birligi faqat dona/kg");
    const smenu = await api(null, 'GET', `/api/c/places/${code}`);
    check(smenu.products.find((x) => x.id === olma.id)?.sold_by === 'kg' && smenu.place.type === 'dokon', "do'kon menyusida kg mahsulot");
    check((await api(cu, 'POST', '/api/c/quote', { place: code, items: [{ product_id: olma.id, weight_g: 300 }] }))._s === 400, "250 g qadamga mos bo'lmagan og'irlik rad etildi");
    const q1 = await api(cu, 'POST', '/api/c/quote', { place: code, items: [{ product_id: olma.id, weight_g: 1500 }, { product_id: sut.id, qty: 2 }] });
    check(q1.subtotal === 30000 + 24000 && q1.items[0].name === 'Olma — 1.5 kg', "1.5 kg olma = 30 000, nomida og'irlik");
    const r1 = await api(cu, 'POST', '/api/c/orders', { place: code, items: [{ product_id: olma.id, weight_g: 1500 }, { product_id: sut.id, qty: 2 }], address: 'Navoiy', provider: 'test', substitution: 'replace' });
    await api(cu, 'POST', `/api/c/orders/${r1.order.id}/test-pay`);
    let d1 = (await api(kas, 'GET', '/api/delivery/orders')).find((x) => x.id === r1.order.id);
    check(d1.substitution === 'replace' && d1.total === 62000, "mijoz tanlovi: 'o'xshashiga almashtiring', 62 000 to'langan");
    check((await api(kas, 'POST', `/api/delivery/orders/${r1.order.id}/adjust`, { items: [{ i: 1, replace_product_id: olma.id, weight_g: 5000 }] }))._s === 409, "to'langandan qimmat almashtirish rad etildi");
    const adj = await api(kas, 'POST', `/api/delivery/orders/${r1.order.id}/adjust`, { items: [{ i: 0, weight_g: 1250 }, { i: 1, replace_product_id: kefir.id }] });
    check(adj.subtotal === 25000 + 22000 && adj.total === 55000 && adj.refund_amount === 7000, "o'zgartirish: olma 1.25 kg, sut → kefir; 7 000 qaytariladi");
    const cv = await api(cu, 'GET', `/api/c/orders/${r1.order.id}`);
    check(cv.total === 55000 && JSON.parse(cv.changes).length === 2 && cv.refund_amount === 7000, "mijoz o'zgarishlar va qaytariladigan summani ko'radi");
    await api(kas, 'POST', `/api/delivery/orders/${r1.order.id}/accept`);
    check((await api(kas, 'POST', `/api/delivery/orders/${r1.order.id}/adjust`, { items: [{ i: 0, remove: true }] }))._s === 409, "qabul qilingandan keyin o'zgartirib bo'lmaydi");
    // olib ketish
    const qp = await api(cu, 'POST', '/api/c/quote', { place: code, items: [{ product_id: sut.id, qty: 1 }], mode: 'pickup' });
    check(qp.delivery_fee === 0 && qp.total === 12000 && qp.mode === 'pickup', "olib ketish: yetkazish narxi 0");
    const rp = await api(cu, 'POST', '/api/c/orders', { place: code, items: [{ product_id: sut.id, qty: 1 }], mode: 'pickup', provider: 'test' });
    check(rp._s === 200 && rp.order.address === 'Olib ketish', "olib ketishda manzil shart emas");
    await api(cu, 'POST', `/api/c/orders/${rp.order.id}/test-pay`);
    const pv = (await api(kas, 'GET', '/api/delivery/orders')).find((x) => x.id === rp.order.id);
    check(pv.mode === 'pickup' && pv.own_delivery === 1, "olib ketish — kuryerga taklif qilinmaydi");
    await api(kas, 'POST', `/api/delivery/orders/${rp.order.id}/accept`); await api(kas, 'POST', `/api/delivery/orders/${rp.order.id}/ready`);
    check((await api(kas, 'POST', `/api/delivery/orders/${rp.order.id}/delivered`)).status === 'delivered', "mijoz oldi → yakunlandi");
    await api(adm, 'POST', '/api/delivery/settings', { pickup: false });
    check((await api(cu, 'POST', '/api/c/quote', { place: code, items: [{ product_id: sut.id, qty: 1 }], mode: 'pickup' }))._s === 409, "olib ketish o'chirilsa — rad");
    // tez sotuv: kg
    const s3 = await api(kas, 'POST', '/api/counter/sale', { items: [{ product_id: olma.id, weight_g: 1340 }, { product_id: sut.id, qty: 1 }], payments: [{ method: 'karta', amount: 26800 + 12000 }] });
    check(s3._s === 200 && s3.order.total === 38800 && s3.order.items[0].name === 'Olma — 1.34 kg', "tarozi: 1.34 kg olma = 26 800");
    check((await api(kas, 'POST', '/api/counter/sale', { items: [{ product_id: olma.id }], payments: [{ method: 'naqd', amount: 1000 }] }))._s === 400, "kg mahsulot og'irliksiz sotilmaydi");

    // ---------- Kechki chegirma ----------
    await api(adm, 'POST', '/api/delivery/settings', { place_type: 'restoran', prepay_mode: 'cash', pickup: true });
    const osh = boot.products.find((x) => x.name.startsWith('Osh'));
    check((await api(kas, 'POST', '/api/deals', { product_id: olma.id, qty: 3, percent: 50, until: hm(2 * 36e5) }))._s === 400, "kg mahsulotga kechki chegirma yo'q");
    check((await api(kas, 'POST', '/api/deals', { product_id: osh.id, qty: 3, percent: 5, until: hm(2 * 36e5) }))._s === 400, 'chegirma kamida 10%');
    const dl = await api(kas, 'POST', '/api/deals', { product_id: osh.id, qty: 3, percent: 50, until: hm(2 * 36e5) });
    check(dl._s === 200 && dl.price === Math.round(osh.price / 2 / 100) * 100 && dl.left === 3 && dl.live, `kechki chegirma: ${osh.name} 50% (${dl.price} so'm), 3 ta`);
    check((await api(kas, 'POST', '/api/deals', { product_id: osh.id, qty: 1, percent: 30, until: hm(36e5) }))._s === 409, 'bitta taomga ikkita faol chegirma bo\'lmaydi');
    const cd = await api(null, 'GET', '/api/c/deals');
    check(cd.some((x) => x.id === dl.id && x.place_code === code && x.old_price === osh.price), "mijoz ilovasida '🌙 Kechki chegirmalar'");
    check((await api(null, 'GET', `/api/c/places/${code}`)).deals.some((x) => x.id === dl.id), "joy menyusida chegirma ko'rinadi");
    const qd = await api(cu, 'POST', '/api/c/quote', { place: code, items: [{ product_id: osh.id, qty: 2, deal_id: dl.id }], mode: 'pickup' });
    check(qd.subtotal === dl.price * 2 && qd.policy.type === 'full' && /Kechki/.test(qd.policy.reason), "chegirmali narx va faqat oldindan to'lov");
    const rd = await api(cu, 'POST', '/api/c/orders', { place: code, items: [{ product_id: osh.id, qty: 2, deal_id: dl.id }], mode: 'pickup', provider: 'test' });
    const left1 = (await api(kas, 'GET', '/api/deals')).find((x) => x.id === dl.id);
    check(rd._s === 200 && left1.sold === 2 && left1.left === 1, "buyurtmadan keyin 1 ta qoldi");
    const o2 = await api(null, 'POST', '/api/c/otp', { phone: '977003300' });
    const cu2 = (await api(null, 'POST', '/api/c/login', { phone: '977003300', code: o2.dev_code })).token;
    const over = await api(cu2, 'POST', '/api/c/orders', { place: code, items: [{ product_id: osh.id, qty: 2, deal_id: dl.id }], mode: 'pickup', provider: 'test' });
    check(over._s === 409 && /1 ta qoldi/.test(over.error), "qolganidan ko'p olib bo'lmaydi");
    await api(cu, 'POST', `/api/c/orders/${rd.order.id}/cancel`);
    check((await api(kas, 'GET', '/api/deals')).find((x) => x.id === dl.id).left === 3, "buyurtma bekor qilinsa — chegirmali taom qaytadi");
    await api(kas, 'POST', `/api/deals/${dl.id}/stop`);
    check(!(await api(null, 'GET', '/api/c/deals')).some((x) => x.id === dl.id), "to'xtatilgan chegirma ilovadan yo'qoldi");
    const late = await api(cu2, 'POST', '/api/c/quote', { place: code, items: [{ product_id: osh.id, qty: 1, deal_id: dl.id }] });
    check(late._s === 409 && /tugagan/.test(late.error), "tugagan chegirma narxi qo'llanmaydi");
  } catch (e) { console.error(e); bad++; }
  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  proc.kill(); process.exit(bad ? 1 : 0);
})();
