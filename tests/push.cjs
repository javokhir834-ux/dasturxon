// Push xabarlar testi: FCM HTTP v1 soxta server bilan (JWT imzo, token, xabar), mobil ilova uchun CORS va /api/health.
const { spawn } = require('child_process');
const ONB = require('./_onboard.cjs');
const ready = require('./_ready.cjs');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'src', 'server.ts'), B = 'http://127.0.0.1:8080', DIR = '/tmp/pushT';
let ok = 0, bad = 0;
const check = (c, m) => { c ? ok++ : bad++; console.log((c ? '  ✓ ' : '  ✗ ') + m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(t, method, p, body, headers = {}) {
  const r = await fetch(B + p, { method, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); return Array.isArray(j) ? Object.assign(j, { _s: r.status, _h: r.headers }) : { ...j, _s: r.status, _h: r.headers };
}
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await wait(200); } return null; };

(async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sent = [], tokens = [];
  const mock = http.createServer((req, res) => {
    let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => {
      if (req.url === '/token') {
        const jwt = new URLSearchParams(d).get('assertion').split('.');
        const okSig = crypto.verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), publicKey, Buffer.from(jwt[2], 'base64url'));
        tokens.push({ okSig, claim: JSON.parse(Buffer.from(jwt[1], 'base64url')) });
        res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
      }
      const m = JSON.parse(d).message; sent.push({ url: req.url, auth: req.headers.authorization, m });
      res.statusCode = m.token === 'dead-token' ? 404 : 200; res.end('{}');
    });
  }).listen(8097);
  const sa = { project_id: 'dx-test', client_email: 'push@dx-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'http://127.0.0.1:8097/token' };
  fs.rmSync(DIR, { recursive: true, force: true });
  const proc = spawn('node', [APP], { env: { ...process.env, DATA_DIR: DIR, PLATFORM_PASSWORD: 'pp-123456', DISPATCH_MS: '300', PUSH_MODE: 'fcm', FCM_SERVICE_ACCOUNT: JSON.stringify(sa), FCM_API_URL: 'http://127.0.0.1:8097' }, stdio: 'ignore' });
  await ready();
  try {
    const h = await api(null, 'GET', '/api/health');
    check(h.ok && h.app === 'dasturxon' && /^\d+\.\d+\.\d+$/.test(h.version), '/api/health ishlaydi (ilova serverni tekshiradi)');
    const pre = await fetch(B + '/api/c/places', { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    check(pre.status === 204 && pre.headers.get('access-control-allow-origin') === 'https://localhost' && /Authorization/.test(pre.headers.get('access-control-allow-headers')), 'Android ilova (https://localhost) uchun CORS preflight');
    const ios = await api(null, 'GET', '/api/c/places', null, { Origin: 'capacitor://localhost' });
    check(ios._h.get('access-control-allow-origin') === 'capacitor://localhost', 'iOS ilova (capacitor://localhost) uchun CORS');
    const evil = await api(null, 'GET', '/api/c/places', null, { Origin: 'https://evil.example' });
    check(!evil._h.get('access-control-allow-origin'), "begona sayt uchun CORS ruxsati yo'q");

    const plat = (await api(null, 'POST', '/api/platform/login', { password: 'pp-123456' })).token;
    await api(plat, 'POST', '/api/platform/businesses/1/subscription', { product: 'delivery', enabled: true, paid_until: '2027-12-31' });
    const adm = (await api(null, 'POST', '/api/login', { pin: '1111' })).token, kas = (await api(null, 'POST', '/api/login', { pin: '2222' })).token, waiter = (await api(null, 'POST', '/api/login', { pin: '3333' })).token;
    await api(kas, 'POST', '/api/shift/open', { opening_cash: 0 });
    await api(adm, 'POST', '/api/delivery/settings', { enabled: true, delivery_fee: 9000, lat: 40.1, lng: 65.37 });
    check((await api(null, 'POST', '/api/c/push-token', { token: 'x' }))._s === 401, 'push token: kirmagan mijoz rad etildi');
    check((await api(kas, 'POST', '/api/push-token', { token: 'staff-kassir', platform: 'android' })).ok, "kassir qurilmasi ro'yxatdan o'tdi");
    await api(waiter, 'POST', '/api/push-token', { token: 'staff-waiter', platform: 'android' });
    const otp = await api(null, 'POST', '/api/c/otp', { phone: '977001234' });
    const cu = (await api(null, 'POST', '/api/c/login', { phone: '977001234', code: otp.dev_code, name: 'Aziz' })).token;
    check((await api(cu, 'POST', '/api/c/push-token', { token: 'cust-1', platform: 'ios' })).ok, "mijoz qurilmasi ro'yxatdan o'tdi");
    await api(cu, 'POST', '/api/c/push-token', { token: 'dead-token' });
    const ko = await api(null, 'POST', '/api/k/otp', { phone: '935550101' });
    const kt = (await api(null, 'POST', '/api/k/login', { phone: '935550101', code: ko.dev_code })).token;
    check((await api(kt, 'POST', '/api/k/push-token', { token: 'courier-1' })).ok, "kuryer qurilmasi ro'yxatdan o'tdi");

    const code = (await api(adm, 'GET', '/api/bootstrap')).business.code;
    const menu = await api(null, 'GET', `/api/c/places/${code}`);
    const r = await api(cu, 'POST', '/api/c/orders', { place: code, items: [{ product_id: menu.products[0].id, qty: 2 }], address: 'Navoiy', provider: 'test' });
    await api(cu, 'POST', `/api/c/orders/${r.order.id}/test-pay`);
    const st = await until(() => sent.find((s) => s.m.token === 'staff-kassir'));
    check(st && /Yangi buyurtma/.test(st.m.notification.title) && st.m.data.id === String(r.order.id) && st.m.android.priority === 'high', 'yangi buyurtma → kassir telefoniga push');
    check(!sent.some((s) => s.m.token === 'staff-waiter'), 'ofitsiantga yetkazish pushi bormaydi');
    check(tokens[0]?.okSig && tokens[0].claim.iss === sa.client_email && /firebase\.messaging/.test(tokens[0].claim.scope), "Google'ga JWT to'g'ri imzolangan (RS256)");
    check(st && st.auth === 'Bearer ya29.test' && st.url === '/v1/projects/dx-test/messages:send', 'FCM v1 manzili va access token');
    const c1 = await until(() => sent.find((s) => s.m.token === 'cust-1' && /restoranga yuborildi/.test(s.m.notification.body)));
    check(!!c1, "mijozga: 'buyurtmangiz restoranga yuborildi'");
    await wait(300);
    const dbx = new (require('node:sqlite').DatabaseSync)(DIR + '/db.sqlite');
    check(!dbx.prepare("SELECT 1 FROM push_tokens WHERE token='dead-token'").get(), "o'chgan (UNREGISTERED) token bazadan o'chirildi");
    await api(kas, 'POST', `/api/delivery/orders/${r.order.id}/accept`, { prep_minutes: 20 });
    check(!!(await until(() => sent.find((s) => s.m.token === 'cust-1' && /qabul qildi/.test(s.m.notification.body)))), "mijozga: 'restoran qabul qildi'");
    // kuryer: ro'yxat → tasdiq → liniya → taklif pushi
    const img = 'data:image/jpeg;base64,' + Buffer.alloc(300, 1).toString('base64');
    await api(kt, 'POST', '/api/k/profile', { name: 'Bek', vehicle: 'velosiped' });
    for (const kind of ['passport', 'selfie']) await api(kt, 'POST', '/api/k/docs', { kind, data: img });
    await api(kt, 'POST', '/api/k/test', { answers: [1, 1, 1, 0, 1, 1, 1, 0] }); await api(kt, 'POST', '/api/k/application', ONB.COURIER_APP); await api(kt, 'POST', '/api/k/consent', ONB.COURIER_CONSENT); await api(kt, 'POST', '/api/k/submit');
    const cid = (await api(plat, 'GET', '/api/platform/couriers'))[0].id;
    await api(plat, 'POST', `/api/platform/couriers/${cid}/status`, { action: 'approve' });
    await api(kt, 'POST', '/api/k/location', { lat: 40.101, lng: 65.37 }); await api(kt, 'POST', '/api/k/online', { online: true });
    const kp = await until(() => sent.find((s) => s.m.token === 'courier-1'));
    check(kp && /9 000|9000/.test(kp.m.notification.title) && kp.m.data.type === 'offer' && kp.m.data.id === String(r.order.id), 'kuryerga taklif pushi (ilova yopiq bo\'lsa ham)');
  } catch (e) { console.error(e); bad++; }
  console.log(`\nNatija: ${ok} ✓, ${bad} ✗`);
  proc.kill(); mock.close(); process.exit(bad ? 1 : 0);
})();
