// 4-etap testi. Server PLATFORM_PASSWORD=platforma-test-1 bilan ishga tushirilgan bo'lishi kerak.
const ONB = require('./_onboard.cjs');
const BASE = 'http://localhost:8080';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
async function api(t, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { ...j, status: r.status };
}
const login = async (code, pin) => (await api(null, 'POST', '/api/login', { code, pin })).token;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };

(async () => {
  check((await api(null, 'POST', '/api/platform/login', { password: 'xato' })).status === 401, "platforma: noto'g'ri parol rad etildi");
  const plat = (await api(null, 'POST', '/api/platform/login', { password: 'platforma-test-1' })).token;
  check(!!plat, 'platformaga kirildi');
  const code1 = (await api(plat, 'GET', '/api/platform/businesses')).find((b) => b.id === 1).code;

  // Ro'yxatdan o'tish
  const reg = await api(null, 'POST', '/api/register', { business_name: 'Kafe Bahor', owner_name: 'Sardor', phone: '90 100 00 01', password: 'parol123', admin_pin: '1234', ...ONB.BIZ, sample: true });
  check(reg.status === 200 && /^\d{6}$/.test(reg.code) && reg.trial_days === 14, `yangi biznes ro'yxatdan o'tdi, kod ${reg.code}`);
  const code2 = reg.code;
  check((await api(null, 'POST', '/api/register', { business_name: 'X', owner_name: 'Y', phone: '901000001', password: 'parol123', admin_pin: '1234', ...ONB.BIZ })).status === 409, "bir telefon bilan qayta ro'yxat rad etildi");
  check((await api(null, 'POST', '/api/login', { pin: '1111' })).status === 400, 'ikki biznes bor — kodsiz kirish rad etildi');
  check((await api(null, 'POST', '/api/login', { code: code2, pin: '1111' })).status === 401, "1-biznes PINi 2-biznesda ishlamaydi");
  check((await api(null, 'GET', `/api/business-info?code=${code2}`)).name === 'Kafe Bahor', 'kod bo\'yicha biznes nomi');

  const a1 = await login(code1, '1111'), k1 = await login(code1, '2222'), a2 = await login(code2, '1234');
  const b2 = await api(a2, 'GET', '/api/bootstrap');
  check(b2.tables.length === 6 && b2.products.length === 8 && b2.business.subscription.status === 'trial' && b2.business.subscription.days_left === 14, "2-biznes: 6 stol, namuna menyu, 14 kunlik sinov");

  // Bizneslar ajratilganligi
  const b1 = await api(a1, 'GET', '/api/bootstrap');
  await api(k1, 'POST', '/api/shift/open', { opening_cash: 0 });
  let o = await api(k1, 'POST', '/api/orders', { table_id: b1.tables[0].id, guests: 2 });
  await api(k1, 'POST', `/api/orders/${o.id}/items`, { product_id: b1.products[0].id, qty: 1 });
  check((await api(a2, 'GET', `/api/orders/${o.id}`)).status === 404, "2-biznes 1-biznes buyurtmasini ko'ra olmaydi");
  check((await api(a2, 'POST', `/api/orders/${o.id}/items`, { product_id: b2.products[0].id })).status === 404, "2-biznes 1-biznes buyurtmasiga yoza olmaydi");
  check((await api(a2, 'POST', '/api/admin/products', { id: b1.products[0].id, price: 1 })).status === 404, "2-biznes 1-biznes menyusini o'zgartira olmaydi");
  check((await api(a2, 'GET', '/api/stock/invoices/1')).status === 404, "2-biznes 1-biznes nakladnoyini ko'ra olmaydi");
  await api(a2, 'POST', '/api/shift/open', { opening_cash: 0 });
  check((await api(a2, 'POST', '/api/orders', { table_id: b1.tables[0].id })).status === 404, "2-biznes 1-biznes stoliga buyurtma ocholmaydi");
  check((await api(a2, 'GET', '/api/orders')).length === 0 && (await api(a2, 'GET', '/api/kitchen')).length === 0, "2-biznes ro'yxatlarida begona buyurtma yo'q");
  const c1 = await api(k1, 'POST', `/api/orders/${o.id}/customer`, { phone: '935554433', name: 'Begona' });
  check((await api(a2, 'GET', `/api/customers/${c1.customer_id}`)).status === 404 && (await api(a2, 'GET', '/api/customers')).length === 0, "mijozlar bazasi ajratilgan");
  check((await api(a2, 'GET', '/api/stock')).length === 0, "2-biznes omborida 1-biznes masalliqlari yo'q");

  // Ega kabineti
  check((await api(null, 'GET', '/api/owner/me')).status === 401, 'kabinet tokensiz yopiq');
  check((await api(null, 'POST', '/api/owner/login', { phone: '901000001', password: 'xato12' })).status === 401, "kabinet: noto'g'ri parol rad etildi");
  const ow = (await api(null, 'POST', '/api/owner/login', { phone: '901000001', password: 'parol123' })).token;
  let me = await api(ow, 'GET', '/api/owner/me');
  check(me.branches.length === 1 && me.branches[0].code === code2 && me.prices.pos === 300000, 'kabinet: 1 filial, narxlar');
  check((await api(ow, 'POST', '/api/owner/branches/1/admin-pin', { pin: '9999' })).status === 404, "ega boshqa birovning biznesiga tegolmaydi");
  const br = await api(ow, 'POST', '/api/owner/branches', { name: 'Kafe Bahor — Chilonzor', copy_from: reg.business_id, admin_pin: '4321', address: 'Chilonzor 5' });
  const a3 = await login(br.code, '4321');
  const b3 = await api(a3, 'GET', '/api/bootstrap');
  check(br.status === 200 && b3.products.length === 8 && b3.tables.length === 6, 'yangi filial menyu va stollari bilan nusxalandi');
  await api(ow, 'POST', `/api/owner/branches/${br.id}/admin-pin`, { pin: '5678' });
  check((await api(a3, 'GET', '/api/bootstrap')).status === 401 && !!(await login(br.code, '5678')), "ega admin PINini tikladi (eski sessiya yopildi)");
  me = await api(ow, 'GET', '/api/owner/me');
  check(me.branches.length === 2 && me.branches[0].shift_open, 'kabinet: 2 filial, smena holati ko\'rinadi');
  check((await api(ow, 'GET', '/api/platform/businesses')).status === 401, "ega tokeni platformaga o'tmaydi");

  // Obuna
  await api(plat, 'POST', `/api/platform/businesses/${reg.business_id}/subscription`, { paid_until: daysFromNow(-2) });
  let b2s = (await api(a2, 'GET', '/api/bootstrap')).business.subscription;
  check(b2s.status === 'grace' && b2s.grace_left === 1 && (await api(a2, 'POST', '/api/orders', { table_id: b2.tables[0].id })).status === 200, "muddat o'tdi — imtiyozli davr, ishlash mumkin");
  await api(plat, 'POST', `/api/platform/businesses/${reg.business_id}/subscription`, { paid_until: daysFromNow(-10) });
  b2s = (await api(a2, 'GET', '/api/bootstrap')).business.subscription;
  check(b2s.status === 'expired' && (await api(a2, 'POST', '/api/orders', { table_id: b2.tables[1].id })).status === 402, "muddat tugadi — yozish bloklandi (402)");
  check((await api(a2, 'GET', '/api/orders')).status === 200, "ko'rish rejimida o'qish ishlaydi");
  const ext = await api(plat, 'POST', `/api/platform/businesses/${reg.business_id}/extend`, { product: 'pos', months: 1, method: 'click' });
  check((await api(a2, 'GET', '/api/bootstrap')).business.subscription.status === 'active' && ext.paid_until === (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return ymd(d); })(), `1 oyga uzaytirildi → ${ext.paid_until}`);
  check((await api(a2, 'POST', '/api/orders', { table_id: b2.tables[1].id })).status === 200, "to'lovdan keyin yozish tiklandi");
  await api(plat, 'POST', `/api/platform/businesses/${reg.business_id}/subscription`, { blocked: true });
  check((await api(a2, 'GET', '/api/bootstrap')).status === 401 && (await api(null, 'POST', '/api/login', { code: code2, pin: '1234' })).status === 403, "bloklandi: sessiya yopildi, kirish rad etildi");
  await api(plat, 'POST', `/api/platform/businesses/${reg.business_id}/subscription`, { blocked: false });
  check(!!(await login(code2, '1234')), 'blokdan chiqarildi');
  const pays = await api(plat, 'GET', '/api/platform/payments');
  check(pays.list.length === 1 && pays.list[0].amount === 300000 && pays.byMonth[0].sum === 300000, "platforma daromadi: 300 000");
  await api(plat, 'POST', '/api/platform/settings', { price_pos: 350000, trial_days: 7 });
  check((await api(plat, 'GET', '/api/platform/settings')).price_pos === 350000, 'narx yangilandi');
  const list = await api(plat, 'GET', '/api/platform/businesses');
  check(list.length === 3 && list.find((b) => b.id === reg.business_id).owner_name === 'Sardor', "platforma: 3 biznes, egasi ko'rinadi");

  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
