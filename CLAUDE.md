# Dasturxon — restoran POS + yetkazib berish platformasi

Egasi: Javohir (Navoiy). Javoblar **o'zbek tilida, qisqa**. Token tejash muhim.

## Avval o'qing
- `PROGRESS.md` — qaysi etap tugagan, qarorlar, ochiq qolganlar, keyingi etap rejasi.
- U "keyingi etapga o't" desa — `.claude/skills/restoran-platforma-etap/SKILL.md` bo'yicha keyingi etapni to'liq qur.

## Stack (o'zgartirmang)
- Node.js 22+, **tashqi paketlarsiz**. `node server.js`. Baza `node:sqlite` (`data/db.sqlite`).
- Frontend: `public/` — build'siz vanilla JS. POS: `app.js` + modullar (`office.js`, `staff.js`, `delivery.js`, `platform.js`).
  Mijoz ilovasi `/app` (`public/app/`), kuryer ilovasi `/courier` (`public/courier/`). Dizayn tokenlari `public/styles.css` boshida.
- Server modullari: `server.js` (yadro, marshrutlar), `office.js`, `staff.js`, `tenant.js` (bizneslar, obuna, platforma), `sync.js` (lokal → bulut),
  `delivery.js` (mijoz ilovasi, to'lov qoidalari), `payments.js` (Payme/Click), `courier.js` (kuryerlar, taqsimlash), `sms.js`, `fiscal.js`, `printer.js`, `config.js` (.env).
- Har jadvalda `business_id`. Pul — butun so'm (INTEGER). Vaqt — ISO. Muhim amallar `audit_log` ga.

## Testlar
- `bash tests/run_all.sh` — barcha API testlar (har biri toza bazada, 8080/8090 portlar).
- `python3 tests/uiN.py` — brauzer testlari (playwright; serverni oldin ishga tushiring, har test boshida izoh bor). Chrome yo'li: `CHROME` env.
- Yangi funksiya → test qo'shing; yetkazishdan oldin hammasi yashil bo'lsin.
