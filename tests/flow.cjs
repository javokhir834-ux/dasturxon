// To'liq oqim testi: login → smena → buyurtma → oshxona → bo'lish → chegirma → pre-chek → to'lov → smena yopish
const BASE = process.env.BASE || 'http://localhost:8080';
let ok = 0, bad = 0;
const check = (cond, msg) => { cond ? ok++ : bad++; console.log((cond ? '  ✓ ' : '  ✗ ') + msg); };
async function api(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); return { ...j, status: r.status, _: j };
}
const login = async (pin) => (await api(null, 'POST', '/api/login', { pin })).token;

(async () => {
  const bad1 = await api(null, 'POST', '/api/login', { pin: '9999' });
  check(bad1.status === 401, "noto'g'ri PIN rad etildi");
  const admin = await login('1111'), kassir = await login('2222'), waiter = await login('3333'), cook = await login('4444');
  check(admin && kassir && waiter && cook, 'hamma rol kirdi');

  const boot = (await api(waiter, 'GET', '/api/bootstrap'))._;
  check(boot.products.length > 10 && boot.tables.length === 12, 'bootstrap: menyu va stollar');
  check(boot.business.fiscal_mode === undefined, "ofitsiant admin sozlamalarini ko'rmaydi");

  const noShift = await api(waiter, 'POST', '/api/orders', { table_id: 1, guests: 2 });
  check(noShift.status === 409, 'smenasiz buyurtma ochilmaydi');
  check((await api(waiter, 'POST', '/api/shift/open', { opening_cash: 100000 })).status === 403, 'ofitsiant smena ocholmaydi');
  const sh = await api(kassir, 'POST', '/api/shift/open', { opening_cash: 100000 });
  check(sh.status === 200 && sh.shift.status === 'open', 'kassir smena ochdi');

  let o = await api(waiter, 'POST', '/api/orders', { table_id: 1, guests: 3 });
  check(o.status === 200 && o.number === 1, 'buyurtma #1 ochildi');
  const osh = boot.products.find((p) => p.name.startsWith('Osh'));
  const tea = boot.products.find((p) => p.name.startsWith("Ko'k choy"));
  const non = boot.products.find((p) => p.name === 'Tandir non');
  const meat = boot.modifiers.find((m) => m.price > 0);
  await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: osh.id, qty: 2 });
  await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: osh.id, qty: 1 });
  await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: osh.id, qty: 1, modifier_ids: [meat.id], comment: 'tez' });
  await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: tea.id, qty: 2 });
  o = await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: non.id, qty: 3 });
  check(o.items.length === 4 && o.items[0].qty === 3, "bir xil taom qo'shilganda soni oshdi");
  const expected = 3 * 35000 + (35000 + meat.price) + 2 * 5000 + 3 * 4000;
  check(o.subtotal === expected, `subtotal to'g'ri (${o.subtotal})`);
  check(o.service === Math.round(expected * 0.1) && o.total === expected + Math.round(expected * 0.1), 'xizmat haqi 10%');

  const other = await login('3333');
  // stop-list
  await api(cook, 'POST', `/api/products/${tea.id}/stop`, { in_stop: true });
  check((await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: tea.id })).status === 409, "stop-listdagi taom qo'shilmaydi");
  await api(cook, 'POST', `/api/products/${tea.id}/stop`, { in_stop: false });

  const sent = await api(waiter, 'POST', `/api/orders/${o.id}/send`);
  check(sent.status === 200 && sent.order.items.every((i) => i.status === 'sent'), 'oshxonaga yuborildi');
  const kitchen = (await api(cook, 'GET', '/api/kitchen'))._;
  check(kitchen.length === 4, 'oshxona ekranida 4 pozitsiya');
  const kOsh = kitchen.find((i) => i.name.startsWith('Osh') && i.qty === 3);
  check((await api(waiter, 'POST', `/api/items/${kOsh.id}/status`, { status: 'ready' })).status === 403, 'ofitsiant "tayyor" qila olmaydi');
  await api(cook, 'POST', `/api/items/${kOsh.id}/status`, { status: 'cooking' });
  await api(cook, 'POST', `/api/items/${kOsh.id}/status`, { status: 'ready' });
  check((await api(waiter, 'POST', `/api/items/${kOsh.id}/status`, { status: 'served' })).status === 200, 'ofitsiant "berildi" qildi');

  const editSent = await api(waiter, 'PATCH', `/api/items/${kOsh.id}`, { qty: 1 });
  check(editSent.status === 409, "yuborilgan taomni ofitsiant o'zgartira olmaydi");
  check((await api(waiter, 'POST', `/api/items/${kOsh.id}/cancel`, { reason: 'x' })).status === 403, 'ofitsiant yuborilgan taomni bekor qila olmaydi');
  const teaItem = sent.order.items.find((i) => i.name.startsWith("Ko'k"));
  o = await api(kassir, 'POST', `/api/items/${teaItem.id}/cancel`, { reason: 'Mijoz rad etdi' });
  check(o.subtotal === expected - 10000, 'kassir choyni sabab bilan bekor qildi');

  // stolni ko'chirish
  o = await api(waiter, 'POST', `/api/orders/${o.id}/move`, { table_id: 2 });
  check(o.table_name === 'Stol 2', "stol ko'chirildi");

  // birlashtirish
  let o2 = await api(waiter, 'POST', '/api/orders', { table_id: 3, guests: 1 });
  await api(waiter, 'POST', `/api/orders/${o2.id}/items`, { product_id: non.id, qty: 1 });
  await api(waiter, 'POST', `/api/orders/${o2.id}/send`);
  o = await api(waiter, 'POST', `/api/orders/${o.id}/merge`, { from_order_id: o2.id });
  check(o.items.some((i) => i.name === 'Tandir non' && i.qty === 1) && o.guests === 4, 'buyurtmalar birlashtirildi');

  // bo'lish
  const nonRow = o.items.find((i) => i.name === 'Tandir non' && i.qty === 3);
  const split = await api(waiter, 'POST', `/api/orders/${o.id}/split`, { items: [{ id: nonRow.id, qty: 1 }] });
  check(split.status === 200 && split.to.items[0].qty === 1 && split.from.items.find((i) => i.id === nonRow.id).qty === 2, "chek bo'lindi (3 nondan 1 tasi)");

  // chegirma
  check((await api(waiter, 'POST', `/api/orders/${o.id}/discount`, { percent: 10, reason: 'x' })).status === 403, 'ofitsiant chegirma bera olmaydi');
  o = await api(kassir, 'POST', `/api/orders/${o.id}/discount`, { percent: 10, reason: 'Doimiy mijoz' });
  check(o.discount === Math.round(o.subtotal * 0.1), 'kassir 10% chegirma berdi');

  // pre-chek
  o = await api(waiter, 'POST', `/api/orders/${o.id}/precheck`);
  check(!!o.precheck_at, 'pre-chek chiqdi');
  check((await api(waiter, 'POST', `/api/orders/${o.id}/items`, { product_id: non.id })).status === 409, "pre-chekdan keyin ofitsiant qo'sha olmaydi");

  // to'lov
  const short = await api(kassir, 'POST', `/api/orders/${o.id}/pay`, { payments: [{ method: 'naqd', amount: 1000 }] });
  check(short.status === 400, 'kam to\'lov rad etildi');
  const card = 50000, cash = o.total - card + 20000;
  const paid = await api(kassir, 'POST', `/api/orders/${o.id}/pay`, { payments: [{ method: 'karta', amount: card }, { method: 'naqd', amount: cash }] });
  check(paid.status === 200 && paid.change === 20000 && paid.order.status === 'closed', `aralash to'lov, qaytim 20 000`);

  // smena yopish
  const closeFail = await api(kassir, 'POST', '/api/shift/close', { counted_cash: 0 });
  check(closeFail.status === 409, 'ochiq buyurtma bor - smena yopilmaydi');
  const so = split.to;
  const p2 = await api(kassir, 'POST', `/api/orders/${so.id}/pay`, { payments: [{ method: 'click', amount: so.total }] });
  check(p2.status === 200, "ikkinchi chek Click bilan to'landi");
  await api(kassir, 'POST', '/api/shift/cash', { type: 'out', amount: 30000, note: 'Non uchun' });
  const rep = (await api(kassir, 'GET', '/api/shift'))._;
  const expCash = 100000 + (cash - 20000) - 30000;
  check(rep.expectedCash === expCash, `kutilgan naqd: ${rep.expectedCash}`);
  check(rep.cancelledItems.length === 1, 'hisobotda bekor qilingan choy bor');
  const closed = await api(kassir, 'POST', '/api/shift/close', { counted_cash: expCash - 5000 });
  check(closed.status === 200 && closed.shift.status === 'closed', 'smena yopildi (Z-hisobot)');

  const log = (await api(admin, 'GET', '/api/audit'))._;
  check(['item_cancel', 'order_discount', 'shift_close', 'order_merge', 'order_split'].every((a) => log.some((l) => l.action === a)), 'audit logda muhim amallar bor');
  check((await api(waiter, 'GET', '/api/audit')).status === 403, "ofitsiant logni ko'rmaydi");

  // admin CRUD
  const np = await api(admin, 'POST', '/api/admin/products', { category_id: osh.category_id, workshop_id: osh.workshop_id, name: 'Dimlama', price: 40000 });
  check(np.status === 200 && np.name === 'Dimlama', "admin yangi taom qo'shdi");
  const nu = await api(admin, 'POST', '/api/admin/users', { name: 'Vali', role: 'ofitsiant', pin: '1111' });
  check(nu.status === 409, 'band PIN rad etildi');
  const lastAdmin = await api(admin, 'POST', '/api/admin/users', { id: 1, role: 'kassir' });
  check(lastAdmin.status === 409, 'oxirgi admin himoyalangan');

  const set = await api(admin, 'POST', '/api/admin/settings', { name: 'Test restoran', service_percent: 12 });
  check(set.status === 200 && set.name === 'Test restoran' && set.service_percent === 12, 'admin sozlamalari saqlandi');
  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
