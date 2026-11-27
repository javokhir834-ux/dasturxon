// 5-etap testi: lokal (8080) ↔ bulut (8090) sinxronizatsiyasi, internet uzilishi, xavfsizlik.
const { spawn } = require('child_process');
const ready = require('./_ready.cjs');
const fs = require('fs');
const APP = require('path').join(__dirname, '..', 'src', 'server.ts');
const L = 'http://127.0.0.1:8080', C = 'http://127.0.0.1:8090';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(base, t, method, path, body) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { _s: r.status }) : { ...j, _s: r.status };
}
const procs = {};
function start(name, env) {
  const p = spawn('node', [APP], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', (d) => { const s = String(d); if (/error|xato/i.test(s) && !/ExperimentalWarning|trace-warnings/.test(s)) console.log(`[${name}] ${s.trim()}`); });
  procs[name] = p; return ready(Number(env.PORT || 8080));
}
const stop = async (name) => { procs[name]?.kill(); await wait(400); };
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
async function drained(tok, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await api(L, tok, 'GET', '/api/admin/sync'); if (s.pending === 0 && !s.initial && s.last_ok) return s; await wait(300); }
  return api(L, tok, 'GET', '/api/admin/sync');
}

(async () => {
  for (const d of ['/tmp/cloud', '/tmp/local']) fs.rmSync(d, { recursive: true, force: true });
  await start('cloud', { MODE: 'cloud', PORT: '8090', DATA_DIR: '/tmp/cloud', PLATFORM_PASSWORD: 'p-123456' });
  await start('local', { PORT: '8080', DATA_DIR: '/tmp/local', SYNC_INTERVAL_MS: '400' });

  // Bulutda biznes va ulash kaliti
  const reg = await api(C, null, 'POST', '/api/register', { business_name: 'Bahor (bulut)', owner_name: 'Sardor', phone: '901000001', password: 'parol123', admin_pin: '1234' });
  const ow = (await api(C, null, 'POST', '/api/owner/login', { phone: '901000001', password: 'parol123' })).token;
  const key = (await api(C, ow, 'POST', `/api/owner/branches/${reg.business_id}/sync-key`)).key;
  check(/^dxs_[0-9a-f]{40}$/.test(key), 'ega kabinetida ulash kaliti yaratildi');

  // Lokalni ulash
  const la = (await api(L, null, 'POST', '/api/login', { pin: '1111' })).token;
  const lk = (await api(L, null, 'POST', '/api/login', { pin: '2222' })).token;
  const lw = (await api(L, null, 'POST', '/api/login', { pin: '3333' })).token;
  check((await api(L, la, 'POST', '/api/admin/sync', { url: 'http://127.0.0.1:8090', key: 'dxs_xato' }))._s === 502, "noto'g'ri kalit rad etildi");
  const on = await api(L, la, 'POST', '/api/admin/sync', { url: 'http://127.0.0.1:8090/', key });
  check(on._s === 200 && on.cloud === 'Bahor (bulut)', 'lokal server bulutga ulandi');
  let st = await drained(la);
  check(st.pending === 0 && !st.last_error, `boshlang'ich nusxa yuborildi (navbat: ${st.pending})`);

  // Bulutdagi nusxa
  check((await api(C, null, 'POST', '/api/login', { code: reg.code, pin: '1234' }))._s === 401, "bulutdagi eski admin o'rnini lokal xodimlar egalladi");
  const ck = (await api(C, null, 'POST', '/api/login', { code: reg.code, pin: '2222' })).token;
  const ca = (await api(C, null, 'POST', '/api/login', { code: reg.code, pin: '1111' })).token;
  const lb = await api(L, la, 'GET', '/api/bootstrap'), cb = await api(C, ca, 'GET', '/api/bootstrap');
  check(cb.products.length === lb.products.length && cb.tables.length === 12 && cb.categories.length === lb.categories.length, `menyu va stollar ko'chdi (${cb.products.length} taom, ${cb.tables.length} stol)`);
  check(cb.business.mirror === true, "bulutdagi biznes 'nusxa' rejimida");
  const lStock = await api(L, la, 'GET', '/api/stock'), cStock = await api(C, ca, 'GET', '/api/stock');
  check(cStock.length === lStock.length && cStock.find((i) => i.name === 'Guruch (devzira)').qty === 50, "ombor qoldiqlari ko'chdi");
  const cCosts = await api(C, ca, 'GET', '/api/costs');
  check(cCosts.find((c) => c.name.startsWith('Osh')).cost === 12470, "texkartalar (FK tarjimasi bilan) ko'chdi — osh tannarxi 12 470");

  // Lokalda sotuv
  await api(L, lk, 'POST', '/api/shift/open', { opening_cash: 100000 });
  const P = (n) => lb.products.find((p) => p.name === n);
  let o = await api(L, lw, 'POST', '/api/orders', { table_id: lb.tables[0].id, guests: 2 });
  await api(L, lw, 'POST', `/api/orders/${o.id}/items`, { product_id: P('Osh (1 porsiya)').id, qty: 2 });
  await api(L, lw, 'POST', `/api/orders/${o.id}/items`, { product_id: P("Ko'k choy (choynak)").id, qty: 1 });
  await api(L, lw, 'POST', `/api/orders/${o.id}/customer`, { phone: '901234567', name: 'Akmal' });
  o = (await api(L, lw, 'POST', `/api/orders/${o.id}/send`)).order;
  await api(L, lk, 'POST', `/api/items/${o.items.find((i) => i.name.startsWith("Ko'k")).id}/cancel`, { reason: 'Rad etdi' });
  o = await api(L, lk, 'GET', `/api/orders/${o.id}`);
  await api(L, lk, 'POST', `/api/orders/${o.id}/pay`, { payments: [{ method: 'naqd', amount: o.total }] });
  // o'chirish: yangi buyurtmaga qo'shilib, keyin olib tashlangan taom
  let o2 = await api(L, lw, 'POST', '/api/orders', { table_id: lb.tables[1].id, guests: 1 });
  o2 = await api(L, lw, 'POST', `/api/orders/${o2.id}/items`, { product_id: P('Somsa').id, qty: 1 });
  await api(L, lw, 'PATCH', `/api/items/${o2.items[0].id}`, { qty: 0 });
  await drained(la);
  const cClosed = await api(C, ca, 'GET', '/api/orders?status=closed');
  const cOpen = await api(C, ca, 'GET', '/api/orders?status=open');
  check(cClosed.length === 1 && cClosed[0].total === o.total && cClosed[0].customer_name === 'Akmal' && cClosed[0].items.some((i) => i.status === 'cancelled'), `yopilgan buyurtma bulutda: ${cClosed[0]?.total} so'm, mijoz va bekor qilingan taom bilan`);
  check(cOpen.length === 1 && cOpen[0].items.length === 0, "o'chirilgan taom bulutda ham o'chdi");
  const lRep = await api(L, la, 'GET', `/api/reports/sales?from=${today}&to=${today}`), cRep = await api(C, ca, 'GET', `/api/reports/sales?from=${today}&to=${today}`);
  check(cRep.revenue === lRep.revenue && cRep.cost === lRep.cost && cRep.products.length === lRep.products.length, `bulut hisoboti lokal bilan bir xil (tushum ${cRep.revenue}, tannarx ${cRep.cost})`);
  const me = await api(C, ow, 'GET', '/api/owner/me');
  check(me.branches[0].revenue === lRep.revenue && me.branches[0].mirror === 1 && !!me.branches[0].last_sync_at && me.branches[0].shift_open, 'ega kabineti uydan: tushum, smena holati, oxirgi sinxron');
  check((await api(C, ck, 'POST', '/api/orders', { table_id: cb.tables[0].id }))._s === 409, "bulutdagi nusxaga yozish taqiqlangan");
  check((await api(C, ca, 'GET', '/api/customers'))[0]?.phone === '998901234567', "mijozlar bazasi ko'chdi");

  // Internet uzilishi
  await stop('cloud');
  for (let i = 0; i < 2; i++) {
    let x = await api(L, lw, 'POST', '/api/orders', { table_id: lb.tables[3 + i].id, guests: 1 });
    await api(L, lw, 'POST', `/api/orders/${x.id}/items`, { product_id: P("Lag'mon").id, qty: 1 });
    x = (await api(L, lw, 'POST', `/api/orders/${x.id}/send`)).order;
    const pay = await api(L, lk, 'POST', `/api/orders/${x.id}/pay`, { payments: [{ method: 'karta', amount: x.total }] });
    check(pay._s === 200, `internetsiz sotuv #${i + 1} lokalda ishladi`);
  }
  await wait(1500);
  st = await api(L, la, 'GET', '/api/admin/sync');
  check(st.pending > 0 && !!st.last_error, `navbatda ${st.pending} ta o'zgarish, xato qayd etildi`);
  await start('cloud', { MODE: 'cloud', PORT: '8090', DATA_DIR: '/tmp/cloud', PLATFORM_PASSWORD: 'p-123456' });
  st = await drained(la, 90000);
  const lRep2 = await api(L, la, 'GET', `/api/reports/sales?from=${today}&to=${today}`);
  const ca2 = (await api(C, null, 'POST', '/api/login', { code: reg.code, pin: '1111' })).token;
  const cRep2 = await api(C, ca2, 'GET', `/api/reports/sales?from=${today}&to=${today}`);
  check(st.pending === 0 && cRep2.orders === 3 && cRep2.revenue === lRep2.revenue, `internet qaytgach navbat yuborildi: bulutda ${cRep2.orders} buyurtma, ${cRep2.revenue} so'm`);

  // Xavfsizlik
  const h = await fetch(L + '/');
  check(h.headers.get('x-frame-options') === 'DENY' && /default-src 'self'/.test(h.headers.get('content-security-policy') || ''), 'xavfsizlik sarlavhalari');
  const hc = await fetch(C + '/');
  check(/max-age/.test(hc.headers.get('strict-transport-security') || ''), 'bulutda HSTS yoqilgan');
  check((await fetch(`${L}/api/stream?token=${la}`)).status === 401, "token URL orqali endi qabul qilinmaydi");
  const tk = (await api(L, la, 'POST', '/api/stream-ticket')).ticket;
  const ac = new AbortController();
  const sres = await fetch(`${L}/api/stream?ticket=${tk}`, { signal: ac.signal });
  check(sres.status === 200 && /event-stream/.test(sres.headers.get('content-type')), "bir martalik chipta bilan real-time ulandi"); ac.abort();
  check((await fetch(`${L}/api/stream?ticket=${tk}`)).status === 401, 'chipta ikkinchi marta ishlamaydi');

  // Sinxronni o'chirish
  await api(L, la, 'POST', '/api/admin/sync', { disable: true });
  await api(L, lk, 'POST', '/api/shift/cash', { type: 'in', amount: 1000, note: 'test' });
  st = await api(L, la, 'GET', '/api/admin/sync');
  check(!st.enabled && st.pending === 0, "sinxron o'chirildi, navbat yozilmaydi");

  // So'rovlar cheklovi
  await stop('local');
  await start('rl', { PORT: '8080', DATA_DIR: '/tmp/local', RATE_LIMIT: '15' });
  const codes = []; for (let i = 0; i < 20; i++) codes.push((await fetch(L + '/api/business-info')).status);
  check(codes.slice(0, 15).every((c) => c === 200) && codes.slice(15).every((c) => c === 429), 'IP bo\'yicha so\'rovlar cheklovi (15/daqiqa → 429)');

  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  Object.values(procs).forEach((p) => p.kill());
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); Object.values(procs).forEach((p) => p.kill()); process.exit(1); });
