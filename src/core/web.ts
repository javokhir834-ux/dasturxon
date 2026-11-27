// HTTP qatlami (Fastify): xavfsizlik sarlavhalari, IP limit, body parserlar, marshrutlar, real-time oqim, rasmlar, statik fayllar.
import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import config, { ROOT } from './config.ts';
import { HttpError } from './http.ts';
import { authUser } from './auth.ts';
import { attachStream, issueTicket, useTicket } from './realtime.ts';
import { productImage } from './images.ts';
import { clientIp, type Ctx } from './context.ts';
import * as monitor from './monitor.ts';

const PUBLIC = path.join(ROOT, 'public');
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
// Xarita fonlari: OpenStreetMap (kam yuklama uchun). Ommaviy ishga tushishda o'z tile server: MAP_TILE_HOST=https://tiles.domen.uz
const MAP_TILES = process.env.MAP_TILE_HOST || 'https://tile.openstreetmap.org';
const SPA = ['app', 'courier']; // /app/* va /courier/* — o'z index.html i
const VERSION: string = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

export function buildServer(ctx: Ctx): FastifyInstance {
  const app = Fastify({ logger: config.MODE === 'cloud' ? { level: 'warn' } : false, bodyLimit: 1e6, trustProxy: config.TRUST_PROXY });

  // ---- Body: bo'sh JSON ham {} (mijozlar body'siz POST yuboradi), Click — form-urlencoded
  app.removeContentTypeParser(['application/json', 'text/plain']);
  const json = (_req: unknown, body: string, done: (e: Error | null, v?: unknown) => void) => {
    try { done(null, body ? JSON.parse(body) : {}); } catch { done(new HttpError(400, "JSON noto'g'ri")); }
  };
  app.addContentTypeParser('application/json', { parseAs: 'string' }, json);
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_r, body: string, done) => done(null, Object.fromEntries(new URLSearchParams(body))));
  app.addContentTypeParser('*', { parseAs: 'string' }, json);

  // ---- Mobil ilovalar (Capacitor) uchun CORS: ilova sahifasi https://localhost (Android) / capacitor://localhost (iOS) dan keladi
  const ORIGINS = (process.env.APP_ORIGINS || 'https://localhost,capacitor://localhost,http://localhost').split(',').map((s) => s.trim()).filter(Boolean);
  app.addHook('onRequest', async (req, reply) => {
    const o = req.headers.origin;
    if (!o || !ORIGINS.includes(o)) return;
    reply.header('Access-Control-Allow-Origin', o).header('Vary', 'Origin').header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      .header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS').header('Access-Control-Max-Age', '86400');
    if (req.method === 'OPTIONS') return reply.code(204).send();
  });
  // Ilovalar serverni tanlashda va tashqi monitoring (UptimeRobot, deploy/healthcheck.sh) shu manzilni tekshiradi; baza ishlamasa — 503
  app.get('/api/health', async (_req, reply) => {
    let dbOk = true;
    try { ctx.db.prepare('SELECT 1').get(); } catch { dbOk = false; }
    if (!dbOk) reply.code(503);
    return { ok: dbOk, app: 'dasturxon', mode: config.MODE, version: VERSION, db: dbOk };
  });

  // ---- Xavfsizlik sarlavhalari va IP bo'yicha limit
  const rate = new Map<string, { n: number; reset: number }>();
  setInterval(() => { const t = Date.now(); for (const [k, v] of rate) if (v.reset < t) rate.delete(k); }, 60000).unref();
  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff').header('X-Frame-Options', 'DENY').header('Referrer-Policy', 'same-origin')
      .header('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)')
      .header('Content-Security-Policy', `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: ${MAP_TILES}; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`);
    if (config.MODE === 'cloud') reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.url.startsWith('/api/sync/push') || req.url === '/api/health') return; // health — monitoring va ilovalar tez-tez tekshiradi
    const ip = clientIp(req.raw);
    const rl = rate.get(ip) || { n: 0, reset: Date.now() + 60000 };
    if (rl.reset < Date.now()) { rl.n = 0; rl.reset = Date.now() + 60000; }
    rl.n++; rate.set(ip, rl);
    if (rl.n > config.RATE_LIMIT) return reply.code(429).header('Retry-After', '60').send({ error: "Juda ko'p so'rov. Bir daqiqadan keyin urining" });
  });

  // ---- Modullarning marshrutlari
  for (const r of ctx.routes) {
    app.route({
      method: r.method as 'GET', url: r.pattern, bodyLimit: r.bodyLimit,
      handler: async (request, reply) => {
        const url = new URL(request.raw.url || '/', 'http://x');
        let user: any = null;
        if (r.roles) {
          user = authUser(request.raw) || ctx.fail(401, 'Kirish talab qilinadi');
          if (!r.roles.includes(user.role)) ctx.fail(403, "Sizda bu amal uchun huquq yo'q");
          ctx.tenant.assertWritable(user, request.raw, url.pathname);
        }
        const out = await r.handler({ req: request.raw, url, body: request.body ?? {}, user, p: (request.params as Record<string, string>) || {} });
        return out === undefined ? reply.send() : reply.send(out);
      },
    });
  }

  // ---- Real-time oqim (SSE): /api/stream-ticket → /api/stream?ticket=
  app.post('/api/stream-ticket', async (req) => {
    const user = authUser(req.raw) || ctx.fail(401, 'Kirish talab qilinadi');
    return { ticket: issueTicket(user.id) };
  });
  app.get('/api/stream', (req, reply) => {
    const user = useTicket(String((req.query as Record<string, string>).ticket || ''));
    if (!user) return reply.code(401).send({ error: 'Kirish talab qilinadi' });
    const headers = reply.getHeaders(); // CORS va xavfsizlik sarlavhalari (hijack dan keyin Fastify yubormaydi)
    reply.hijack();
    attachStream(reply.raw, user.business_id, (fn) => req.raw.on('close', fn), headers);
  });

  // ---- Mahsulot rasmlari
  app.get('/img/p/:id', (req, reply) => {
    const img = productImage(Number((req.params as Record<string, string>).id));
    if (!img) return reply.code(404).send();
    reply.header('Cache-Control', 'public, max-age=604800, immutable').type(img.type).send(img.data);
  });

  // ---- Statik fayllar (public/), SPA: noma'lum yo'l → tegishli index.html
  const serveStatic = (pathname: string, reply: any) => {
    let file = path.normalize(path.join(PUBLIC, decodeURIComponent(pathname)));
    if (!file.startsWith(PUBLIC)) return reply.code(403).send();
    if (!path.extname(file) && fs.existsSync(file + '.html')) file += '.html'; // /legal/privacy → privacy.html (Play uchun chiroyli havola)
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = SPA.map((d) => (pathname === '/' + d || pathname.startsWith(`/${d}/`) ? path.join(PUBLIC, d, 'index.html') : null)).find(Boolean) || path.join(PUBLIC, 'index.html');
    reply.code(200).header('Cache-Control', 'no-cache').type(MIME[path.extname(file)] || 'application/octet-stream').send(fs.createReadStream(file));
  };
  app.setNotFoundHandler((req, reply) => {
    const p = new URL(req.raw.url || '/', 'http://x').pathname;
    if (p.startsWith('/api/') || req.method !== 'GET') return reply.code(404).send({ error: 'Topilmadi' });
    serveStatic(p, reply);
  });

  // ---- Xatolar: HttpError → o'z statusi; Payme — har doim 200 + JSON-RPC xato
  app.setErrorHandler((e: any, req, reply) => {
    if (req.url.startsWith('/api/pay/payme')) return reply.code(200).send({ id: null, error: { code: -32700, message: { uz: "So'rov noto'g'ri", ru: 'Ошибка парсинга', en: 'Parse error' } } });
    if (e instanceof HttpError) return reply.code(e.status).send({ error: e.message });
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: "Juda katta so'rov" });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    console.error(e);
    monitor.record(e, `${req.method} ${req.url.split('?')[0]}`);
    reply.code(500).send({ error: 'Serverda xatolik' });
  });
  return app;
}
