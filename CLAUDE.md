# FastHub Uz (kod nomi: Dasturxon) — restoran/dorixona/do'kon POS + yetkazib berish platformasi (server + 3 mobil ilova)

Brend (2026-11-25): **FastHub Uz**. Ilovalar: *FastHub Uz* (mijoz), *FastHub Kuryer*, *FastHub Biznes*; paket ID `uz.fasthub.app|courier|business` (`mobile/brand.json`).
Kodda ichki nom `dasturxon` qoladi (repo, `/api/health` → `app: 'dasturxon'`, localStorage `dx_*`) — o'zgartirmang.

Egasi: Javohir (Navoiy). Javoblar **o'zbek tilida, qisqa**. Token tejash muhim.

## Avval o'qing
- `PROGRESS.md` — qaysi etap tugagan, arxitektura, qarorlar, texnik qarz, keyingi etap rejasi.
- U "keyingi etapga o't" desa — `.claude/skills/restoran-platforma-etap/SKILL.md` bo'yicha keyingi etapni to'liq qur.

## Stack (o'zgartirmang)
- **Server:** Node.js 22.18+ **TypeScript** (build yo'q, `node src/server.ts`), **Fastify 5**, **Zod 4**, baza `node:sqlite` (`data/db.sqlite`).
- **Frontend:** `public/` — build'siz vanilla JS: POS `/`, mijoz `/app`, kuryer `/courier`. Dizayn tokenlari `public/styles.css` boshida.
- **Mobil:** `mobile/` — Capacitor 8: `apps/mijoz`, `apps/kuryer`, `apps/biznes` (Android + iOS). Veb qismi `public/` dan olinadi (`mobile/build.mjs`).

## Yangi funksiya qo'shish qoidalari
1. Yangi etap/modul = `src/modules/<nom>.ts`: `export default function nom(ctx: Ctx) { ... return { ...boshqalarga kerak funksiyalar } }`,
   `src/modules/index.ts` dagi `MODULES` ro'yxatiga bitta qator (tartib muhim: keyingisi oldingilardan foydalanadi).
2. Marshrut: `ctx.route('POST', '/api/...', ctx.ROLES.CASH, ({ user, body, p, url, req }) => natija)`. `roles=null` — ochiq (mijoz/kuryer/platforma o'z tokenini tekshiradi).
   Yo'llar: xodim `/api/...`, mijoz `/api/c/...`, kuryer `/api/k/...`, platforma `/api/platform/...`.
3. Kirish ma'lumoti: yangi kodda **Zod**: `const b = ctx.parse(ctx.z.object({ ... }), body)`. Xato: `ctx.fail(409, "o'zbekcha xabar")`.
4. Sxema modul ichida: `CREATE TABLE IF NOT EXISTS` + yangi ustun `addCol` (ALTER, try/catch). Har jadvalda `business_id`. Pul — INTEGER so'm, vaqt — ISO.
5. Muhim amal → `ctx.audit(user, 'amal', 'jadval', id, {...})`. Real-time → `ctx.broadcast(businessId, 'tur', {...})`. Push → `ctx.push.toStaff|toCustomer|toCourier`.
6. Tashqi xizmat (SMS, to'lov, fiskal, push) — `src/services/` da adapter, kalitlarsiz "test" rejimida ishlasin.
7. Frontend `public/` da: rasm/yo'l serverdan bo'lsa `DX.asset(url)` (ilovada to'liq manzil). `fetch('/api/..')` ilovada o'zi serverga ketadi.
8. Mobil ilovaga yangi ruxsat/plagin kerak bo'lsa — `mobile/sync.mjs` (ruxsatlar) va `mobile/package.json` + `apps/*/package.json`.

## Tekshirish (yetkazishdan oldin hammasi yashil)
- `npm run check` — tsc xatosiz.
- `npm test` — barcha API testlar (`tests/*.cjs`, har biri toza bazada, 8080/8090 portlar). Yangi funksiya → test qo'shing.
- `python3 tests/uiN.py` — brauzer testlari (serverni oldin ishga tushiring; har fayl boshida izoh). `ui8.py` — mobil ilovalar (oldin `cd mobile && node build.mjs`).
- `public/` yoki `mobile/` o'zgarsa: `cd mobile && node build.mjs && node sync.mjs`. Push qilinganda GitHub Actions APK yig'adi.
