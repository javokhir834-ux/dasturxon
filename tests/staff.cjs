// 3-etap testi. Server TG_API=http://localhost:8099 bilan ishga tushirilgan bo'lishi kerak.
const http = require('http');
const fs = require('fs');
const BASE = 'http://localhost:8080';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
async function api(t, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); return Array.isArray(j) ? Object.assign(j, { status: r.status }) : { ...j, status: r.status };
}
const login = async (pin) => (await api(null, 'POST', '/api/login', { pin })).token;
const tg = [];
const mock = http.createServer((req, res) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { tg.push({ url: req.url, body: JSON.parse(d || '{}') }); res.end('{"ok":true}'); }); }).listen(8099);
const d = new Date(); const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const admin = await login('1111'), kassir = await login('2222'), waiter = await login('3333');
  // Rollar
  const om = await api(admin, 'POST', '/api/admin/users', { name: 'Omborchi', role: 'omborchi', pin: '5555' });
  const mn = await api(admin, 'POST', '/api/admin/users', { name: 'Menejer', role: 'menejer', pin: '6666' });
  check(om.role === 'omborchi' && mn.role === 'menejer', 'yangi rollar: omborchi, menejer');
  const omT = await login('5555'), mnT = await login('6666');
  check((await api(omT, 'GET', '/api/stock')).status === 200 && (await api(omT, 'POST', '/api/orders', { table_id: 1 })).status === 403, "omborchi: ombor bor, buyurtma yo'q");
  check((await api(mnT, 'GET', `/api/reports/sales?from=${today}&to=${today}`)).status === 200 && (await api(mnT, 'POST', '/api/admin/users', { name: 'x', role: 'kassir', pin: '7777' })).status === 403, 'menejer: hisobot bor, xodim yaratish yo\'q');

  // Ish vaqti va maosh sozlamasi
  const boot = await api(waiter, 'GET', '/api/bootstrap');
  const wid = boot.user.id;
  const c1 = await api(waiter, 'POST', '/api/time/clock');
  check(!!c1.clock, 'ofitsiant ishga keldi (clock in)');
  await api(admin, 'POST', '/api/admin/users', { id: wid, pay_type: 'hourly', rate: 15000, percent: 5, percent_base: 'sales' });
  const st = new Date(); st.setHours(0, 30, 0, 0); const en = new Date(st); en.setHours(8, 30);
  const ts = await api(mnT, 'POST', '/api/time', { user_id: wid, start_at: st.toISOString(), end_at: en.toISOString(), note: 'tungi smena' });
  check(ts.status === 200, "menejer qo'lda ish vaqti qo'shdi (8 soat)");

  // Mijozlar
  await api(kassir, 'POST', '/api/shift/open', { opening_cash: 0 });
  const P = (n) => boot.products.find((p) => p.name === n);
  let o1 = await api(waiter, 'POST', '/api/orders', { table_id: 1, guests: 2 });
  await api(waiter, 'POST', `/api/orders/${o1.id}/items`, { product_id: P('Osh (1 porsiya)').id, qty: 2 });
  o1 = await api(waiter, 'POST', `/api/orders/${o1.id}/customer`, { phone: '90 123 45 67', name: 'Akmal' });
  check(o1.customer_phone === '998901234567' && o1.customer_name === 'Akmal', 'mijoz telefon orqali yaratildi va biriktirildi');
  check((await api(waiter, 'POST', `/api/orders/${o1.id}/customer`, { phone: '123' })).status === 400, "noto'g'ri telefon rad etildi");
  o1 = (await api(waiter, 'POST', `/api/orders/${o1.id}/send`)).order;
  const pay1 = await api(kassir, 'POST', `/api/orders/${o1.id}/pay`, { payments: [{ method: 'naqd', amount: o1.total }] });
  check(pay1.bonus && pay1.bonus.earned === Math.round(o1.total * 0.05), `keshbek 5%: +${pay1.bonus?.earned}`);
  const cust = (await api(kassir, 'GET', '/api/customers?q=Akmal'))[0];
  check(cust.visits === 1 && cust.bonus === pay1.bonus.earned && cust.spent === o1.total, 'mijoz statistikasi: 1 tashrif, bonus, sarflagan');
  check((await api(kassir, 'POST', '/api/customers', { id: cust.id, discount_percent: 10 })).status === 403, 'kassir shaxsiy chegirma bera olmaydi');
  await api(mnT, 'POST', '/api/customers', { id: cust.id, discount_percent: 10, birthday: '1995-03-08' });
  let o2 = await api(waiter, 'POST', '/api/orders', { table_id: 2, guests: 1 });
  await api(waiter, 'POST', `/api/orders/${o2.id}/items`, { product_id: P("Lag'mon").id, qty: 1 });
  o2 = await api(waiter, 'POST', `/api/orders/${o2.id}/customer`, { customer_id: cust.id });
  check(o2.discount_percent === 10 && o2.discount_reason === 'Mijoz kartasi', "mijoz kartasi chegirmasi avtomatik qo'llandi");
  o2 = (await api(waiter, 'POST', `/api/orders/${o2.id}/send`)).order;
  check((await api(kassir, 'POST', `/api/orders/${o2.id}/pay`, { payments: [{ method: 'bonus', amount: cust.bonus + 1 }, { method: 'naqd', amount: o2.total }] })).status === 400, "bonusdan ortiq to'lash rad etildi");
  const pay2 = await api(kassir, 'POST', `/api/orders/${o2.id}/pay`, { payments: [{ method: 'bonus', amount: 3000 }, { method: 'naqd', amount: o2.total - 3000 }] });
  const expBal = cust.bonus - 3000 + Math.round((o2.total - 3000) * 0.05);
  check(pay2.status === 200 && pay2.bonus.balance === expBal, `bonus sarflandi va qayta yig'ildi (qoldiq ${pay2.bonus?.balance})`);

  // Bronlar
  const t1 = new Date(Date.now() + (new Date(Date.now() + 36e5).getDate() === new Date().getDate() ? 36e5 : -36e5)); /* yarim tunda ham 'bugun' ichida */ const hm = `${String(t1.getHours()).padStart(2, '0')}:${String(t1.getMinutes()).padStart(2, '0')}`;
  const rdate = `${t1.getFullYear()}-${String(t1.getMonth() + 1).padStart(2, '0')}-${String(t1.getDate()).padStart(2, '0')}`;
  const tables = boot.tables;
  const r1 = await api(kassir, 'POST', '/api/reservations', { type: 'stol', table_id: tables[4].id, name: 'Dilshod', phone: '931112233', guests: 4, date: rdate, time: hm, duration_min: 120, deposit: 100000, deposit_method: 'naqd' });
  check(r1.status === 200 && r1.deposit === 100000, 'bron + 100 000 zaklad');
  const clash = await api(kassir, 'POST', '/api/reservations', { type: 'stol', table_id: tables[4].id, name: 'Boshqa', guests: 2, date: rdate, time: hm, duration_min: 60 });
  check(clash.status === 409, 'bir vaqtda bitta stolga ikki bron rad etildi');
  check((await api(waiter, 'POST', '/api/reservations', { type: 'stol', table_id: tables[5].id, name: 'x', date: rdate, time: hm })).status === 403, 'ofitsiant bron yarata olmaydi');
  const up = await api(waiter, 'GET', '/api/reservations/upcoming');
  check(up.some((r) => r.id === r1.id), "bron zal uchun 'yaqin bronlar'da ko'rinadi");
  const arr = await api(waiter, 'POST', `/api/reservations/${r1.id}/status`, { status: 'arrived' });
  let o3 = await api(waiter, 'GET', `/api/orders/${arr.order_id}`);
  check(arr.status === 200 && o3.deposit === 100000 && o3.guests === 4 && o3.customer_name === 'Dilshod', 'mehmon keldi: buyurtma zaklad va mijoz bilan ochildi');
  await api(waiter, 'POST', `/api/orders/${o3.id}/items`, { product_id: P('Qozon kabob').id, qty: 3 });
  o3 = (await api(waiter, 'POST', `/api/orders/${o3.id}/send`)).order;
  check((await api(kassir, 'POST', `/api/orders/${o3.id}/pay`, { payments: [{ method: 'zaklad', amount: 150000 }, { method: 'naqd', amount: o3.total }] })).status === 400, "zakladdan ortiq summa rad etildi");
  const pay3 = await api(kassir, 'POST', `/api/orders/${o3.id}/pay`, { payments: [{ method: 'zaklad', amount: 100000 }, { method: 'karta', amount: o3.total - 100000 }] });
  check(pay3.status === 200, "zaklad + karta bilan to'landi");
  const resList = await api(kassir, 'GET', `/api/reservations?date=${rdate}`);
  check(resList.find((r) => r.id === r1.id).status === 'done', 'bron yakunlandi');
  const r2 = await api(kassir, 'POST', '/api/reservations', { type: 'banket', table_id: tables[8].id, name: "To'y oldi", phone: '941234567', guests: 30, date: rdate, time: hm, duration_min: 240, deposit: 500000, deposit_method: 'naqd', per_person: 150000, note: 'Osh, salatlar' });
  await api(kassir, 'POST', `/api/reservations/${r2.id}/status`, { status: 'cancelled', refund: true });
  let rep = await api(kassir, 'GET', '/api/shift');
  check(rep.byMethod.zaklad === 100000 && rep.cashIn === 600000 && rep.cashOut === 500000, 'smena: zaklad alohida, kirim 600k, qaytarish 500k');

  // Maosh
  const pr = await api(mnT, 'GET', `/api/payroll?from=${today}&to=${today}`);
  const w = pr.find((x) => x.id === wid);
  const sales = o1.total - o1.service + (o2.subtotal - o2.discount) + (o3.subtotal - o3.discount);
  check(w.hours >= 8 && w.base === Math.round(w.hours * 15000) && w.percent_sum === Math.round((o1.subtotal - o1.discount + o2.subtotal - o2.discount + o3.subtotal - o3.discount) * 0.05), `maosh: ${w.hours} soat → ${w.base}, foiz ${w.percent_sum}`);
  await api(mnT, 'POST', '/api/payroll/pay', { user_id: wid, amount: 50000, type: 'avans', from_cash: true, note: 'tushlik' });
  const pr2 = await api(mnT, 'GET', `/api/payroll?from=${today}&to=${today}`);
  rep = await api(kassir, 'GET', '/api/shift');
  check(pr2.find((x) => x.id === wid).paid === 50000 && rep.cashOut === 550000, 'avans berildi, kassadan chiqim yozildi');
  const c2 = await api(waiter, 'POST', '/api/time/clock');
  check(c2.clock === null, 'ofitsiant ishdan ketdi (clock out)');

  // Telegram
  await api(admin, 'POST', '/api/admin/loyalty', { tg_token: 'TESTTOKEN', tg_chat: '12345', tg_time: '23:59', cashback_percent: 5 });
  const lt = await api(admin, 'GET', '/api/admin/loyalty');
  check(lt.tg_token_set === true && lt.tg_token === undefined, "token saqlandi va tashqariga qaytarilmaydi");
  const tt = await api(admin, 'POST', '/api/admin/telegram/test');
  check(tt.status === 200 && tg.some((m) => m.url === '/botTESTTOKEN/sendMessage' && m.body.chat_id === '12345' && m.body.text.includes('Tushum')), 'Telegram test xabari yuborildi');
  const close = await api(kassir, 'POST', '/api/shift/close', { counted_cash: rep.expectedCash });
  await wait(500);
  check(close.status === 200 && tg.some((m) => m.body.text.includes('smena') && m.body.text.includes('yopildi')), "smena yopilganda Z-hisobot Telegramga ketdi");
  const bk = fs.readdirSync((process.env.DATA_DIR || require('path').join(__dirname, '..', 'data')) + '/backups');
  check(bk.some((f) => /^db-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f)) && bk.some((f) => f.includes('smena-')), `zaxira nusxalar: ${bk.join(', ')}`);

  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  mock.close(); process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); mock.close(); process.exit(1); });
