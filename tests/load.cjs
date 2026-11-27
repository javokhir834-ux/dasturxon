// Yuklama sinovi (npm test ga kirmaydi). Ishlatish:
//   node tests/load.cjs                         — o'zi toza bazada server ochadi (port 8085), 20 parallel, 20 soniya
//   node tests/load.cjs https://pos.domen.uz 50 30  — tayyor serverga: manzil, parallel so'rovlar, soniya
// Mijoz ilovasining eng ko'p chaqiriladigan so'rovlari: joylar ro'yxati, menyu, health. Natija: so'rov/soniya, p50/p95/p99, xatolar.
// Bulut serverda RATE_LIMIT (bir IP dan daqiqasiga) yuklamani to'xtatadi — sinov paytida .env da vaqtincha oshiring.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const [, , target, conc = '20', secs = '20'] = process.argv;
const C = Number(conc), DUR = Number(secs) * 1000;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let base = target, proc = null;
  if (!base) {
    const dir = path.join(os.tmpdir(), 'dx-load');
    fs.rmSync(dir, { recursive: true, force: true });
    proc = spawn('node', [path.join(__dirname, '..', 'src', 'server.ts')], { env: { ...process.env, DATA_DIR: dir, PORT: '8085', RATE_LIMIT: '1000000' }, stdio: 'ignore' });
    base = 'http://127.0.0.1:8085';
    for (let i = 0; i < 40; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} await wait(250); }
  }
  const places = await (await fetch(base + '/api/c/places')).json().catch(() => []);
  const paths = ['/api/health', '/api/c/places', '/api/c/deals', ...places.slice(0, 5).map((p) => '/api/c/places/' + p.code)];
  console.log(`Yuklama: ${base} · ${C} parallel · ${DUR / 1000} s · ${paths.length} xil so'rov`);

  const lat = [], codes = {};
  let errors = 0;
  const end = Date.now() + DUR;
  const worker = async (n) => {
    for (let i = n; Date.now() < end; i++) {
      const t0 = performance.now();
      try {
        const r = await fetch(base + paths[i % paths.length]); await r.arrayBuffer();
        codes[r.status] = (codes[r.status] || 0) + 1; if (r.status >= 500) errors++;
      } catch { errors++; }
      lat.push(performance.now() - t0);
    }
  };
  await Promise.all(Array.from({ length: C }, (_, n) => worker(n)));
  lat.sort((a, b) => a - b);
  const q = (p) => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))]?.toFixed(1);
  console.log(`So'rovlar: ${lat.length} (${Math.round(lat.length / (DUR / 1000))}/s) · xato: ${errors} · status: ${JSON.stringify(codes)}`);
  console.log(`Kechikish, ms: p50 ${q(0.5)} · p95 ${q(0.95)} · p99 ${q(0.99)} · max ${lat.at(-1)?.toFixed(1)}`);
  if (proc) proc.kill();
  process.exit(errors ? 1 : 0);
})();
