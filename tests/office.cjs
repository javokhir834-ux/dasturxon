// 2-etap testi: ombor, texkarta, sotuvda hisobdan chiqarish, kirim, chiqim, ishlab chiqarish, inventarizatsiya, ta'minotchi, hisobot
const BASE = 'http://localhost:8080';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
async function api(t, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { ...j, status: r.status };
}
const login = async (pin) => (await api(null, 'POST', '/api/login', { pin })).token;
const near = (a, b, eps = 0.0011) => Math.abs(a - b) < eps;

(async () => {
  const admin = await login('1111'), kassir = await login('2222'), waiter = await login('3333');
  check((await api(waiter, 'GET', '/api/stock')).status === 403, "ofitsiant omborni ko'rmaydi");
  let stock = await api(admin, 'GET', '/api/stock');
  const S = (n) => stock.find((x) => x.name === n);
  check(S('Guruch (devzira)').qty === 50 && S('Xamir').qty === 10 && near(S('Un').qty, 53.5), "boshlang'ich qoldiqlar (un 60-6.5, xamir 10)");
  const costs = await api(admin, 'GET', '/api/costs');
  const oshCost = costs.find((c) => c.name.startsWith('Osh'));
  check(oshCost.cost === 12470 && oshCost.margin === 64, `osh tannarxi 12 470, marja ${oshCost.margin}%`);

  const boot = await api(waiter, 'GET', '/api/bootstrap');
  const P = (n) => boot.products.find((p) => p.name === n);
  await api(kassir, 'POST', '/api/shift/open', { opening_cash: 100000 });
  let o = await api(waiter, 'POST', '/api/orders', { table_id: 1, guests: 2 });
  await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: P('Osh (1 porsiya)').id, qty: 2 });
  await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: P("Lag'mon").id, qty: 1 });
  o = (await api(waiter, 'POST', `/api/orders/${o.id}/send`)).order;
  const lag = o.items.find((i) => i.name === "Lag'mon");
  o = await api(kassir, 'POST', `/api/items/${lag.id}/cancel`, { reason: 'Kuyib qoldi', writeoff: true });
  stock = await api(admin, 'GET', '/api/stock');
  check(near(S('Xamir').qty, 9.85), 'bekor qilingan lag\'mon masalliqlari hisobdan chiqdi (xamir 9.85)');
  const paid = await api(kassir, 'POST', `/api/orders/${o.id}/pay`, { payments: [{ method: 'naqd', amount: o.total }] });
  check(paid.status === 200 && paid.order.items.find((i) => i.name.startsWith('Osh')).cost === 12470, "to'lovda taom tannarxi yozildi");
  stock = await api(admin, 'GET', '/api/stock');
  check(near(S('Guruch (devzira)').qty, 49.76) && near(S("Mol go'shti").qty, 20 - 0.14 - 0.06), "sotuvda guruch 0.24, go'sht hisobdan chiqdi");

  // Kirim + o'rtacha tannarx + ta'minotchi qarzi
  const sups = await api(admin, 'GET', '/api/suppliers');
  const sup = sups.find((s) => s.name.startsWith('Dehqon'));
  check(sup.debt === 0, "boshlang'ich qarz 0");
  const inv = await api(admin, 'POST', '/api/stock/invoices', { supplier_id: sup.id, number: 'N-15', items: [{ ingredient_id: S('Guruch (devzira)').id, qty: 10, price: 30000 }, { ingredient_id: S('Sabzi').id, qty: 20, price: 7000 }], paid_now: 200000, from_cash: true });
  check(inv.status === 200 && inv.total === 440000, 'nakladnoy 440 000');
  stock = await api(admin, 'GET', '/api/stock');
  const avg = Math.round((49.76 * 28000 + 10 * 30000) / 59.76);
  check(near(S('Guruch (devzira)').qty, 59.76) && S('Guruch (devzira)').cost === avg, `guruch o'rtacha narxi ${avg}`);
  const sups2 = await api(admin, 'GET', '/api/suppliers');
  check(sups2.find((s) => s.id === sup.id).debt === 240000, "ta'minotchi qarzi 240 000");
  await api(admin, 'POST', `/api/suppliers/${sup.id}/pay`, { amount: 40000, method: 'naqd', from_cash: true, note: 'qisman' });
  check((await api(admin, 'GET', '/api/suppliers')).find((s) => s.id === sup.id).debt === 200000, "qarz to'landi → 200 000");
  const rep = await api(kassir, 'GET', '/api/shift');
  check(rep.cashOut === 240000, 'kassadan chiqim smenada aks etdi (240 000)');

  // Hisobdan chiqarish
  const wo = await api(admin, 'POST', '/api/stock/writeoff', { reason: 'Buzilgan', items: [{ ingredient_id: S('Pomidor').id, qty: 2 }] });
  stock = await api(admin, 'GET', '/api/stock');
  check(wo.status === 200 && near(S('Pomidor').qty, 12.95), 'pomidor 2 kg hisobdan chiqdi (15 − 0.05 lagmon − 2)');

  // Yarim tayyor: xamir tayyorlash
  const unBefore = S('Un').qty;
  await api(admin, 'POST', '/api/stock/produce', { semi_id: S('Xamir').id, qty: 5 });
  stock = await api(admin, 'GET', '/api/stock');
  check(near(S('Xamir').qty, 14.85) && near(S('Un').qty, unBefore - 3.25), 'xamir 5 kg tayyorlandi, un 3.25 kg kamaydi');

  // Texkarta tahriri
  const rp = await api(admin, 'PUT', `/api/recipes/product/${P('Kompot (1 l)').id}`, { lines: [{ ingredient_id: S('Quruq meva').id, qty: 0.1 }] });
  check(rp.status === 200 && rp.cost === 4000, 'kompot texkartasi saqlandi (4 000)');
  check((await api(admin, 'PUT', `/api/recipes/semi/${S('Xamir').id}`, { lines: [{ ingredient_id: S('Xamir').id, qty: 1 }] })).status === 400, "yarim tayyor o'zidan iborat bo'lolmaydi");

  // Inventarizatsiya
  const invn = await api(admin, 'POST', '/api/stock/inventory', { note: 'Oylik', items: [{ ingredient_id: S('Guruch (devzira)').id, actual: 59 }, { ingredient_id: S('Piyoz').id, actual: '' }] });
  stock = await api(admin, 'GET', '/api/stock');
  check(invn.status === 200 && S('Guruch (devzira)').qty === 59 && invn.diff_sum === Math.round(-0.76 * avg), `inventarizatsiya: kamomad ${invn.diff_sum}`);

  // Masalliq yaratish
  const ni = await api(admin, 'POST', '/api/stock/ingredients', { name: 'Zira', unit: 'kg', cost: 150000, min_qty: 0.2 });
  stock = await api(admin, 'GET', '/api/stock');
  check(ni.status === 200 && S('Zira').low === true, "yangi masalliq qo'shildi, kam qoldiq belgisi");

  // Hisobot
  const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const r = await api(admin, 'GET', `/api/reports/sales?from=${today}&to=${today}`);
  check(r.status === 200 && r.orders === 1 && r.revenue === paid.order.total && r.cost === 24940, `hisobot: tushum ${r.revenue}, tannarx ${r.cost}`);
  check(r.products[0].abc === 'A' && r.waiters[0].orders === 1 && r.hours.length === 24, 'ABC, ofitsiantlar, soatlar');
  check(r.writeoffs > 0 && r.inventoryDiff < 0, `chiqimlar ${r.writeoffs}, inventarizatsiya farqi ${r.inventoryDiff}`);
  check((await api(kassir, 'GET', `/api/reports/sales?from=${today}&to=${today}`)).status === 403, "kassir hisobotni ko'rmaydi");

  const moves = await api(admin, 'GET', '/api/stock/moves');
  check(['sale', 'income', 'writeoff', 'inventory', 'produce_in', 'produce_out'].every((t) => moves.some((m) => m.type === t)), "harakatlar jurnalida barcha turlar");
  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
