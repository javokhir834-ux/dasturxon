# PROGRESS — Dasturxon platformasi

Keyingi etapni boshlashdan oldin shu faylni o'qing. Har etap oxirida yangilang.

## Holat
- **Tugagan:** 1-etap — POS yadro, 2-etap — Ofis, 3-etap — Xodimlar va mijozlar, 4-etap — Ko'p biznes va obuna, 5-etap — Bulut, 6-etap — Mijoz ilovasi, 7-etap — Kuryer ilovasi (hammasi 2026-11-24)
- **Keyingi:** 8-etap — Platforma admin (hisob-kitob, nizolar, qora ro'yxat)

## Arxitektura
- Node.js 22+, tashqi paketlarsiz. Server: `server.js` (marshrutlar `route(method, pattern, roles, handler)`).
- Baza: `node:sqlite` → `data/db.sqlite`. Sxema va namuna ma'lumotlar: `db.js` (`CREATE TABLE IF NOT EXISTS`).
  Yangi ustunlar uchun keyingi etaplarda `ALTER TABLE` migratsiyasi qo'shilsin (try/catch bilan).
- Real-time: SSE `/api/stream?token=` → `change` hodisasi `{type: orders|kitchen|menu|shift}`. Mijoz qayta yuklab oladi.
- Frontend: `public/` (build'siz SPA). `app.js`: `A.*` — tugma harakatlari (`data-a`), `view*` — ekranlar, `modal()` — oynalar.
  Dizayn tokenlari `styles.css` boshida (umumiy, brendsiz).
- Har bir jadvalda `business_id` bor (hozircha 1). Multi-tenant uchun tayyor.
- Pul: so'mda, INTEGER. Vaqt: ISO string.
- Rollar: admin, kassir, ofitsiant, oshpaz. PIN 4 raqam (sha256 + salt). Sessiyalar xotirada (server qayta ishga tushsa, qayta kiriladi).

## 1-etapda qilingan
- Zallar va stollar, stol holati (band, pre-chek, tayyor taom, yuborilmagan), stolni ko'chirish, cheklarni birlashtirish, chekni bo'lish (qisman soni bilan).
- Ofitsiant: buyurtma, mehmonlar soni, modifikatorlar (narxli/narxsiz), oshxonaga izoh, bir xil taom avtomatik qo'shiladi.
  Ofitsiant faqat o'z buyurtmalarini o'zgartiradi.
- Oshxona ekrani (KDS): sexlar filtri, 3 ustun, taymer (10/20 daqiqa ranglari), bitta yoki hammasini o'tkazish, stop-list.
- Sexlar bo'yicha tarmoq printerlariga avtomatik chop etish (ESC/POS :9100), bekor qilishda ham chiqadi.
- Kassa: naqd/karta/Click/Payme, aralash to'lov, qaytim, chegirma (% yoki summa, sabab bilan), xizmat haqi %, pre-chek (qulflaydi), brauzer orqali 80 mm chek.
- Smena: ochish (boshlang'ich naqd), kirim/chiqim, X-hisobot, yopish (sanalgan naqd → farq), Z-hisobot, oldingi smenalar.
- Admin: menyu, kategoriyalar, modifikatorlar, stollar, zallar, sexlar/printerlar, xodimlar (PIN, rol, o'chirish/tiklash, oxirgi admin himoyasi), sozlamalar, jurnal.
- Audit jurnali: login, buyurtma, yuborish, bekor qilish, chegirma, ko'chirish, birlashtirish, bo'lish, pre-chek, to'lov, smena, kassa, stop-list, CRUD.
- Fiskal adapter (`fiscal.js`): rejimlar `off`, `mock`. Mahsulotda `mxik` maydoni bor.
- Testlar: API oqimi 38/38, brauzer (kassir, oshpaz, admin, telefon) xatosiz.

## 2-etapda qilingan
- Fayllar: `office.js` (server: sxema, marshrutlar, sotuv hooklari, namuna ombor), `public/office.js` (Ombor va Hisobotlar ekranlari).
  `server.js` dagi ulanish: `require('./office')(ctx)`; `/pay` da `office.writeOffSale`, `/items/:id/cancel` da `writeoff: true` bo'lsa `office.writeOffCancelled`.
  Frontend: `VIEWS` registri (`app.js`), office.js `VIEWS.stock` va `VIEWS.reports` qo'shadi. SSE turi `stock` qo'shildi.
- Jadvallar: `ingredients` (unit kg/l/dona, cost = o'rtacha narx, min_qty, is_semi), `recipe_items` (owner_type product|semi),
  `stock_moves` (qoldiq = SUM(qty); turlar: income, sale, writeoff, inventory, produce_in, produce_out), `suppliers`, `invoices`, `invoice_items`,
  `supplier_payments`, `inventories`, `inventory_items`. `order_items.cost` ustuni (ALTER bilan).
- Masalliqlar: qoldiq, o'rtacha narx (kirimda vaznli o'rtacha), minimal qoldiq ogohlantirishi, manfiy qoldiqqa ruxsat (qizil ko'rinadi).
- Texnologik kartalar: taom → masalliqlar (1 porsiya, brutto); yarim tayyor mahsulot (masalan xamir) o'z kartasi bilan, "tayyorlash" amali.
- To'lovda masalliqlar avtomatik hisobdan chiqadi va taom tannarxi `order_items.cost` ga yoziladi.
  Tayyorlangan taom bekor qilinsa, kassir "masalliqlarni hisobdan chiqarish" belgisini qo'yadi (tayyorlanayotgan/tayyor bo'lsa avtomatik belgilangan).
- Kirim (nakladnoy) ta'minotchi bilan, qisman to'lov, kassadan to'lash → smenada chiqim.
- Hisobdan chiqarish (sabab bilan), inventarizatsiya (faqat sanalgan qatorlar, farq summasi), harakatlar jurnali.
- Ta'minotchilar: olingan / to'langan / qarz, to'lov (naqd kassadan, karta, o'tkazma).
- Hisobotlar (admin): tushum, buyurtma, o'rtacha chek, tannarx, yalpi foyda va marja (xizmat haqisiz), chegirmalar, hisobdan chiqarilgan,
  inventarizatsiya farqi, to'lov turlari, kunlar va soatlar grafigi, ofitsiantlar, kategoriyalar, ABC tahlil (oldingi jamg'arilgan ulush < 80% → A, < 95% → B).
  Texkartasiz sotilgan taomlar ogohlantiriladi.
- Testlar: 1-etap API 38/38, 2-etap API 23/23, brauzer testlari xatosiz.

## 3-etapda qilingan
- Fayllar: `staff.js` (server), `public/staff.js` (Bronlar, Mijozlar, Xodimlar ekranlari va ulanishlar).
  `app.js` da `HOOKS` ulanish joylari: `onStart`, `onChange(types)`, `header`, `tableBadge(t)`, `ticketCustomer(o)`, `adminSettings(main)`.
  `renderView()` endi view promise'ini qaytaradi.
- **Marshrutlash tuzatildi:** aniq yo'llar (`/api/admin/settings`) `:param` li yo'llardan (`/api/admin/:entity`) oldin tekshiriladi.
  Avval admin sozlamalarini saqlash ishlamas edi (1-etap xatosi), endi testda tekshiriladi.
- **Migratsiya:** `users.role` va `payments.method` CHECK cheklovlari olib tashlandi (`rebuildWithoutCheck`, eski bazada avtomatik).
  Yangi ustunlar: users (pay_type, rate, percent, percent_base), orders (customer_id, deposit, reservation_id),
  businesses (cashback_percent, tg_token, tg_chat, tg_time, tg_last). 2-etap bazasidan yangilanish sinovdan o'tgan.
- **Rollar:** admin, menejer, kassir, ofitsiant, oshpaz, omborchi. `ROLES`: ALL, FLOOR, CASH, KITCHEN, STOP, STOCK, REPORTS, MANAGE, ADMIN.
  Menejer: zal, kassa, bron, mijozlar, ombor, xodimlar, hisobotlar, jurnal (Boshqaruv yo'q). Omborchi: faqat ombor.
- **Sessiyalar** `sessions` jadvalida (token sha256), server qayta ishga tushsa ham saqlanadi, 30 kun.
- **Ish vaqti:** sarlavhadagi "Ishga keldim / ketdim" tugmasi, `timesheets`; menejer qo'lda qo'shadi va tahrirlaydi (jurnalga yoziladi).
- **Maosh:** soatbay yoki oylik (davr kunlariga mutanosib) + foiz (o'z sotuvidan chegirmadan keyin yoki xizmat haqidan), avans va maosh to'lovlari,
  kassadan berilsa smenada chiqim bo'ladi. `payroll_payments`.
- **Mijozlar:** telefon bo'yicha (998XXXXXXXXX), ism, tug'ilgan kun (±3 kun belgisi), izoh, shaxsiy chegirma (faqat menejer/admin),
  statistika (tashrif, sarflagan, o'rtacha chek, oxirgi tashrif), tashriflar va bonus tarixi.
  Buyurtmaga telefon orqali biriktiriladi (yo'q bo'lsa yaratiladi), shaxsiy chegirma avtomatik qo'llanadi ("Mijoz kartasi").
- **Bonus (keshbek):** to'lovdan keyin bonusdan tashqari to'langan pulning `cashback_percent` ulushi qo'shiladi. To'lov usuli `bonus`,
  balansdan oshmaydi. Qo'lda tuzatish (sabab bilan). `bonus_moves`.
- **Bronlar:** stol yoki banket (kishi boshiga narx, menyu izohi), vaqt, davomiylik, bir stolga ustma-ust bron rad etiladi.
  Zaklad: naqd bo'lsa kassaga kirim. "Keldi" → buyurtma ochiladi (mijoz, zaklad, chegirma bilan); to'lovda `zaklad` usuli (zakladdan oshmaydi).
  Bekor + qaytarish (naqd → kassadan chiqim), "kelmadi" (zaklad qoladi). Zalda 3 soat ichidagi bron belgisi.
- **Telegram:** bot token + chat ID + vaqt; kunlik hisobot (tushum, to'lov turlari, bekor qilinganlar, top-5, kam qolgan masalliqlar),
  smena yopilganda Z-hisobot (kamomad bilan). Token API orqali qaytarilmaydi. Test uchun `TG_API` muhit o'zgaruvchisi.
- **Zaxira nusxa:** `data/backups` — har kuni (startda va har soat tekshiradi), har smena yopilganda, qo'lda; oxirgi 40 ta saqlanadi (`VACUUM INTO`).
- Testlar: 1-etap 39/39, 2-etap 23/23, 3-etap 29/29 (soxta Telegram server bilan), 3 ta brauzer testi xatosiz, migratsiya testi.

## 4-etapda qilingan
- Fayllar: `tenant.js` (server), `public/platform.js` (`#register`, `#owner`, `#platform` sahifalari). `app.js`: biznes kodi qadami (`renderCodeStep`),
  obuna banneri (`subBanner`), hash marshrutlash (`boot`). `PLATFORM_UI` — `typeof` bilan tekshiriladi (top-level const window'da emas).
- **Biznes kodi:** `businesses.code` (6 xonali, takrorlanmas). Kirish: `{code, pin}`; serverda bitta biznes bo'lsa, kodsiz ham ishlaydi
  (`/api/business-info` kodsiz → yagona biznes). Qurilma kodni `localStorage.bizcode` da saqlaydi. PIN faqat biznes ichida noyob.
- **Ro'yxatdan o'tish** (`POST /api/register`): ega (telefon + parol, scrypt), biznes, admin PIN, namuna menyu ixtiyoriy, 14 kun sinov. IP bo'yicha 5/soat.
- **Ega kabineti** (`/api/owner/*`, alohida `owner_sessions`): filiallar ro'yxati va davr bo'yicha tushum/buyurtma/ochiq buyurtma/smena holati,
  obuna holati, yangi filial (boshqa filialdan nusxa: zal, stollar, sexlar, kategoriyalar, menyu, modifikatorlar, masalliqlar, texkartalar; qoldiq/xodim ko'chmaydi),
  admin PIN tiklash (eski sessiyalar yopiladi), filial nomi/manzili, parol almashtirish. Ega faqat o'z filiallariga kira oladi.
- **Obuna:** `subscriptions` (business_id, product pos|delivery, paid_until, trial, blocked, enabled). Holatlar: trial, active, grace (imtiyozli davr),
  expired, blocked, disabled. Expired/blocked → yozish so'rovlari 402 (ruxsat: logout, time/clock, shift/close); blocked → kirish 403 va sessiyalar o'chiriladi.
  Eski bizneslarga yangilanishda 30 kun sinov beriladi. Yetkazib berish obunasi hozircha faqat holat (6-etapda ishlatiladi), standart o'chirilgan.
- **Platforma paneli** (`/api/platform/*`, alohida `platform_sessions`): parol `PLATFORM_PASSWORD` yoki birinchi ishga tushishda yaratiladi →
  `data/platforma-parol.txt`. Bizneslar (ega, kod, obuna, 30 kunlik buyurtma, bugungi tushum, to'langan), uzaytirish (muddat o'tgan bo'lsa bugundan,
  aks holda muddat oxiridan), sanani qo'lda o'rnatish, bloklash, yetkazib berishni yoqish, narxlar/sinov/imtiyoz kunlari, parol, to'lovlar va oylik daromad.
- Testlar: 1-etap 39/39, 2-etap 23/23, 3-etap 29/29, 4-etap 34/34 (bizneslararo ajratilganlik, obuna bloki, kabinet, platforma), 4 ta brauzer testi xatosiz,
  3-etap bazasidan yangilanish sinovi.

## 5-etapda qilingan
- Fayllar: `config.js` (.env yuklash, MODE/HOST/PORT/TRUST_PROXY/RATE_LIMIT), `sync.js` (lokal → bulut), `deploy/` (setup-ubuntu.sh, update.sh,
  dasturxon.service, Caddyfile.example), `DEPLOY.md`, `.env.example`. `server.js` birinchi qatorda `require('./config')`.
- **Qaror: bulutda ham SQLite (WAL) qoldi, Postgres'ga o'tilmadi.** Sabab: barcha so'rovlar `node:sqlite` sinxron API'da yozilgan,
  Postgres uchun hammasini async qilib qayta yozish katta xavf. Bitta VPS'da 50–100+ restoran uchun SQLite yetarli. Yuklama oshsa — `db` qatlamini adapterga ajratib o'tish.
- **Sinxronizatsiya (lokal → bulut, bir tomonlama):**
  - Lokal: `SPEC` jadvallari (22 ta) uchun AFTER INSERT/UPDATE/DELETE triggerlar → `sync_outbox` (faqat `businesses.sync_key != ''` bo'lsa).
    Har 3 soniyada (`SYNC_INTERVAL_MS`) 300 talik paket; qator birinchi VA oxirgi o'rnida, eng so'nggi holati bilan yuboriladi (FK tartibi uchun).
    Xato bo'lsa — eksponensial kutish (60s gacha), `sync_last_error`. Ulanishda butun baza snapshot (`enqueueSnapshot`) + `reset`.
  - Bulut: `POST /api/sync/push` (Bearer ulash kaliti, sha256 `sync_key_hash`), `sync_map` (business, jadval, local_id → cloud_id) orqali ID va FK tarjimasi
    (`recipe_items.owner_id` dinamik). `reset` — biznesning barcha sinxron jadvallari va xaritasi tozalanadi. Biznes `mirror=1` bo'ladi:
    xodimlar lokal PINi bilan kiradi, hamma yozish so'rovlari 409 (faqat ko'rish). `invoice_items`, `inventory_items` sinxronlanmaydi.
  - Ega kabineti: "Lokal serverni ulash" → kalit (bir marta ko'rsatiladi), filialda oxirgi sinxron vaqti. Lokal: Boshqaruv → Sozlamalar → Bulut sinxronizatsiya.
- **Xavfsizlik:** CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy, bulutda HSTS; IP bo'yicha so'rovlar cheklovi (`RATE_LIMIT`/daqiqa, 429);
  SSE uchun bir martalik 60 soniyalik chipta (`POST /api/stream-ticket`), token URL'da endi qabul qilinmaydi; `TRUST_PROXY` da IP X-Forwarded-For dan.
  Bulut rejimida server faqat 127.0.0.1 da tinglaydi.
- **Joylash:** setup-ubuntu.sh — Node 22, Caddy (avtomatik HTTPS, SSE uchun flush_interval -1), systemd (qattiq cheklovlar), ufw, kunlik zaxira cron.
  Skriptlar `bash -n` bilan tekshirilgan; haqiqiy VPS'da sinalmagan.
- Testlar: 1-etap 39/39, 2-etap 23/23, 3-etap 29/29, 4-etap 34/34, 5-etap 26/26 (ikki server: boshlang'ich nusxa, sotuv, o'chirish, mijoz bog'lanishi,
  hisobot tengligi, ega kabineti, nusxaga yozish taqiqi, **internet uzilishi va tiklanishi**, xavfsizlik, cheklov), 5 ta brauzer testi xatosiz.
- Tuzatildi: maosh ekranda ko'rinadigan (yaxlitlangan) soatdan hisoblanadi.

## Ochiq qolganlar (huquqiy yoki tashqi)
- Haqiqiy fiskal provayder (reestrdagi virtual kassa) — Javohir tanlashi kerak.
- Click/Payme kassada qo'lda to'lov turi; mijoz ilovasida onlayn integratsiya kodi tayyor (6-etap), lekin haqiqiy merchant hisobi (YaTT/MChJ + bank) ulanmagan.
- HTTPS yo'q (lokal tarmoq). Bulutga chiqishda (5-etap) majburiy.
- SSE token URL'da (lokal tarmoq uchun qabul qilingan).
- Telegram haqiqiy serverda sinalmagan (ish muhitidan api.telegram.org ga chiqib bo'lmaydi) — soxta server bilan sinalgan. Restoranda "Sinov xabari" bilan tekshirish kerak.
- Bonus to'lovi va zaklad fiskal chekda qanday ko'rsatilishi fiskal provayder ulanganda aniqlanadi.
- Sinxron: ma'lumotlar lokal → bulut; bulutdan lokalga faqat yetkazib berish buyurtmalari (6-etap kanali).
- Bulutdagi nusxa faqat ko'rish uchun. Lokal kompyuter butunlay buzilsa, bulutdan ishlashga o'tish: ega kabinetida "unmirror" (API bor, UI yo'q) — keyin.
- `.env` dagi `PLATFORM_PASSWORD` har ishga tushishda parolni qayta o'rnatadi (panelda o'zgartirilsa, .env qatorini o'chirish kerak).
- Deploy skriptlari haqiqiy VPS'da sinalmagan — birinchi o'rnatishda kuzatib borish kerak.
- Obuna to'lovi qo'lda qayd etiladi (platforma paneli). Click/Payme orqali avtomatik obuna to'lovi 5–6 etaplarda.
- Ega parolini unutsa tiklash yo'q (SMS kerak) — hozircha platforma orqali qo'lda.
- Ombor bitta (ko'p ombor/filial 4-etapda). Nakladnoyni tahrirlash/bekor qilish yo'q — xato bo'lsa hisobdan chiqarish yoki inventarizatsiya bilan tuzatiladi.

## 6-etapda qilingan
- **Mijoz ilovasi** `/app` (telefon uchun, bulutda): joylar katalogi (tur filtri), menyu (kategoriyalar, rasmlar, stop-list), savat (bitta joydan), manzil + GPS, izoh,
  telefon + SMS kod bilan kirish (`SMS_MODE=test` da kod ekranda), to'lov sahifasi, buyurtmalarim, buyurtma holati (vaqt chizig'i, taxminiy vaqt, 5 s da yangilanadi), bekor qilish.
- **To'lov qoidasi** (`delivery.js` → `policy`): rejim mixed/full/cash; yangi mijoz → 100% oldindan; ishonchli (N ta muvaffaqiyatli, 0 no-show) → naqd yoki qisman %;
  avval olmagan mijoz → 100%; naqd limitdan oshsa → 100%; qaytarilmaydigan taomli qimmat buyurtma → 100%. Mijoz xohlasa hammasini onlayn to'laydi.
- **To'lovlar** (`payments.js`): `test` provayder; Payme Merchant API (JSON-RPC, tiyin, idempotent, 12 soat) `/api/pay/payme`; Click Prepare/Complete (MD5 imzo) `/api/pay/click/*`.
  Kalitlar `.env` da bo'lmasa faqat test. To'lanmagan buyurtma 30 daqiqada bekor bo'ladi. Rad/bekor qilinganda to'langan pul → `refund_due`.
- **Holatlar:** awaiting_payment → new → accepted → ready → on_way → delivered (+ cancelled, rejected, no_show). Mijoz hisoblagichlari: completed, no_shows, cancels.
- **POS:** "🛵 Yetkazish" bo'limi (kassir/menejer/admin): Yangi/Tayyorlanmoqda/Tayyor/Yo'lda ustunlari, qabul (tayyorlash vaqti), rad (sabab), tayyor, kuryerga berildi,
  yetkazildi, mijoz olmadi; bugungi tarix. Yangi buyurtmada ovoz + toast + menyuda qizil belgi, qabul qilinmaguncha har 30 s ovoz.
  Qabul → POS buyurtma (`orders.type='delivery'`, `delivery_id`) va oshxonaga; oshxonada hammasi tayyor → avtomatik "tayyor"; yetkazildi → chek yopiladi (onlayn qism `onlayn`/click/payme, qolgani naqd);
  rad/olmadi → POS buyurtma bekor (masalliq hisobdan chiqadi). Oldindan to'langan va olinmagan buyurtma — restoran pulini oladi.
- **Boshqaruv → Yetkazib berish:** yoqish, hozir qabul qilish, tur, manzil, tavsif, min. buyurtma, yetkazish narxi, tayyorlash vaqti, to'lov qoidalari. Menyu: "ilovada sotiladi", "qaytarib bo'lmaydi", rasm (brauzerda ≈480 px ga kichraytiriladi, ≤300 KB).
  Rasmlar `/img/p/:id` orqali keshlanib beriladi (bootstrap va menyu yengil).
- **Platforma:** komissiya % sozlamasi (standart 12), har buyurtmada taom summasidan hisoblanadi (`delivery_orders.commission`).
- **Lokal serverli restoran:** buyurtma bulutda yaratiladi → lokal server tortadi (mahsulot ID lari tarjima qilinadi) → restoranda qabul → holatlar bulutga; internet uzilsa navbatda turadi (`dirty`).
  Bulutdagi nusxadan qabul qilib bo'lmaydi (409). Lokal serverda yetkazish obunasini bulut tekshiradi.
- Hisobotlarda "Onlayn (ilova)" to'lov turi. KDS da "🛵 Yetkazib berish" yorlig'i.
- Yangi jadvallar: `delivery_settings`, `delivery_orders`, `app_users`, `app_sessions`, `otp_codes`, `payment_tx`. Ustunlar: `products.delivery/non_returnable/image`, `orders.type/delivery_id`, `businesses.delivery_since`.
- Testlar: `tests/delivery.js` (55), `tests/delivery_sync.js` (11, ikki server + internet uzilishi), `tests/ui6.py` (to'liq oqim brauzerda), `tests/run_all.sh` (hamma API testlar).

### 6-etap qarorlari
- Yetkazish narxi POS chekiga kirmaydi (kassa tushumi = taom summasi); u kuryer xizmatiga tegishli — 7-etapda kuryerga/platformaga taqsimlanadi.
- Komissiya taom summasidan (yetkazish narxisiz). Hisob-kitob (restoranga to'lash, komissiyani ushlash) — 8-etap (platforma admin).
- Modifikatorlar mijoz ilovasida hozircha tanlanmaydi (API qo'llaydi), izoh orqali.
- Mijoz savati bitta joydan; boshqa joydan qo'shsa savat tozalanishi so'raladi.

### 6-etap ochiq qolganlari
- SMS provayder (Eskiz/Playmobile) ulanmagan — `SMS_MODE=test`. Haqiqiy ishga tushirishdan oldin ulash shart.
- Payme/Click haqiqiy merchant hisobi va yuridik shaxs; marketplace (pulni restoranga bo'lib o'tkazish) shartnomasi.
- `refund_due` qaytarish hozir qo'lda (Payme/Click kabinetidan) — avtomatik qaytarish va nizolar 8-etapda.
- Xarita tanlash (pin) yo'q — GPS koordinata + matnli manzil. Kuryer GPS kuzatuvi 7-etapda.
- PWA (o'rnatiladigan ilova, push xabar) — keyin; hozir oddiy mobil sayt.

## 7-etapda qilingan
- **Kuryer ilovasi** `/courier` (telefon uchun, bulutda; `courier.js` + `public/courier/`):
  - Ro'yxat: telefon + SMS → ism, transport (piyoda/velosiped/moto/avto, raqam) → hujjat rasmlari (pasport, selfi, moto/avto uchun guvohnoma; brauzerda 1200 px JPEG) →
    8 savollik qoidalar testi (7/8; xato bo'lsa 10 daqiqadan keyin) → ariza (`pending`).
  - Platforma tasdiqlaydi → `probation` (sinov davri, `probation_orders`=20 ta buyurtma va reyting ≥4.5 → avtomatik `active`). Rad etish/bloklash sabab bilan.
  - Liniya (online/offline), GPS har 10 s, ilova har 3 s holatni so'raydi (taklif, faol buyurtma).
- **Taqsimlash (taksi kabi, `dispatchTick` har 2 s):** restoran qabul qilgach (`delivery_by='platform'`, `own_delivery=0`) eng yaqin bo'sh kuryerga taklif
  (masofa − daraja×0.3 km), `offer_seconds` (30 s) ichida javob bo'lmasa yoki rad etsa — keyingisiga. Shartlar: liniyada, GPS 3 daqiqadan yangi, faol buyurtmasi yo'q,
  `dispatch_radius_km` (7) ichida, naqd buyurtmada qo'ldagi naqd + shu naqd ≤ naqd limit, 24 soatdan eski topshirilmagan naqd yo'q. Hamma rad etsa — qaytadan aylanadi.
  Restoran kuryer topilmasa "O'zimiz yetkazamiz" bosadi.
- **Buyurtma bosqichlari** (`courier_status`): assigned → at_restaurant → picked (faqat `ready` bo'lsa, **plomba rasmi majburiy**) → at_customer → topshirish **4 xonali kod** bilan
  (mijozda ko'rinadi, kuryerga berilmaydi; 5 urinish). Olishdan oldin voz kechish mumkin (hisoblanadi).
- **No-show tartibi:** yetib keldi + qo'ng'iroq + eshik rasmi + 10 daqiqa (`NOSHOW_WAIT_SEC`) + GPS mijoz koordinatasidan 300 m ichida → `no_show`;
  kuryer yo'l haqini oladi (oldindan to'lovdan, bo'lmasa kafolat fondidan), taom kuryerda qoladi, restoran oldindan to'langan bo'lsa pulini oladi.
- **Pul:** kuryer haqi = max(yetkazish narxi, `courier_min_fee`) + daraja bonusi. `courier_moves` hisobi: fee/bonus (+), cash (−, mijozdan olingan naqd), cash_in (+, topshirildi),
  payout (−, kuryerga to'landi), bonus/penalty, deposit (alohida). Naqd limit = min(daraja limiti, depozit) — depozitsiz kuryerga naqd buyurtma bermaydi.
  Kafolat fondi `fund_moves`: har yetkazilgan buyurtmadan taom summasining `fund_percent` (1%) i.
  Restoran chekida kuryer olgan naqd `kuryer` usuli bilan yoziladi (kassadagi kutilgan naqdga qo'shilmaydi).
- **Reyting va darajalar:** mijoz 1–5 yulduz beradi; oxirgi 50 ta o'rtacha. <4.5 — ogohlantirish, ≥10 baho va <4.0 — avtomatik blok.
  Darajalar: Yangi (0) → Bronza (20, 4.5+, +500, limit 300k) → Kumush (100, 4.7+, +1000, 500k) → Oltin (300, 4.85+, +1500, 800k).
- **Platforma paneli → Kuryerlar:** ro'yxat, ariza (hujjat rasmlari), tasdiqlash/rad/blok, MyID belgisi, depozit, kunlik naqd qabul qilish, to'lov, bonus/jarima, kafolat fondi.
  Sozlamalar: komissiya, fond %, kuryer minimal haqi, taklif vaqti, radius, sinov davri.
- **Restoran:** doskada kuryer (ism, reyting, transport, telefon, GPS, holat) yoki "Kuryer qidirilmoqda"; kuryer buyurtmasini restoran "yo'lda/yetkazildi" qila olmaydi.
  Sozlamada "Kim yetkazadi" (platforma/o'zimiz) va restoran joylashuvi. Smena yopiq paytda yetkazilsa — `pos_pending`, kassir "Chekni yopish" bosadi.
- **Mijoz:** kuryer ma'lumoti, masofa, xaritada havola, 4 xonali kod, yetkazilgach baholash.
- **Lokal serverli restoran:** taqsimlash bulutda; lokal tortishda kuryer ma'lumoti (`courier_info`) keladi, kuryer yakunlasa lokalda chek avtomatik yopiladi (`finish`).
- Yangi jadvallar: `couriers`, `courier_sessions`, `courier_docs`, `courier_moves`, `delivery_photos`, `fund_moves`. `delivery_orders`, `delivery_settings` ga ustunlar.
- Testlar: `tests/courier.js` (67), `tests/delivery_sync.js` (18, kuryer + lokal restoran), `tests/ui7.py` (kuryer ilovasi to'liq oqim).

### 7-etap qarorlari
- Bitta kuryer — bitta faol buyurtma (bir yo'lda bir nechta buyurtma keyin).
- Kuryer ilovasi SSE emas, 3 s so'rov (polling) — oddiy va ishonchli; push xabar PWA bilan keyin.
- Yetkazish narxi to'liq kuryerga; restoran 0 qo'ysa ham kuryer minimal haqini oladi (farqi hisob-kitobda — 8-etap).
- Kuryer telefonini mijoz va restoran ko'radi (raqamni yashirish — telefoniya provayderi bilan keyin).

### 7-etap ochiq qolganlari
- **MyID** haqiqiy integratsiyasi (shartnoma kerak) — hozir platforma qo'lda belgilaydi.
- Kuryer bilan shartnoma/oferta (YaTT, o'zini o'zi band qilgan) — yurist.
- Xarita ichida jonli kuzatuv (Yandex Maps API kaliti) — hozir havola.
- Push xabar (ilova yopiq bo'lsa ham taklif) — PWA/Telegram bot orqali keyin.
- Kuryerga avtomatik to'lov (karta) — hozir platforma qo'lda.

## 8-etapda qilingan
- Fayllar: `platform.js` (server), `public/platadmin.js` (platforma bo'limlari), `tests/platform.js` (64 test). `public/platform.js` — bo'limlar menyusi (`nav`), ichki yordamchilar eksport qilinadi.
  Mijoz ilovasi: shikoyat ekrani `#claim/:id`, qarz qatori. Kuryer ilovasi: "Hisob" da nizolar, e'tiroz, muammo bildirish; blok ekranida e'tiroz. POS "Yetkazish": xavf belgisi, hisob-kitob va nizolar bloki (menejer/admin), ⚠️ shikoyat tugmasi.
- **Hisob-kitob (akt):** restoran ulushi = taom (+ o'zi yetkazgan bo'lsa yetkazish narxi) − komissiya − restoran o'zi olgan naqd ± tuzatishlar.
  No-show: oldindan to'langan bo'lsa restoran taom pulini oladi (komissiya bilan), aks holda 0. Akt sanagacha yakunlangan buyurtmalarni oladi (`delivery_orders.settlement_id`),
  to'landi / bekor (faqat ochiq). Qo'lda tuzatish (±). Restoran o'z aktlarini POS da ko'radi (`/api/delivery/settlements`, MANAGE).
- **Mijoz qarzi:** platforma kuryeri bilan naqd buyurtmada mijoz olmasa — fonddan to'langan kuryer haqi `app_users.debt` ga yoziladi; keyingi buyurtmaga qo'shiladi (`debt_amount`), to'liq oldindan to'lov;
  to'langach qarz yopiladi va fondga qaytadi. POS chekiga qarz kirmaydi.
- **Nizolar:** mijoz (yakunlangandan keyin `dispute_days`=2 kun ichida, bitta), restoran (kuryer/mijoz/platformaga), kuryer (restoran/mijozga; blokdan e'tiroz) ochadi.
  Isbotlar: plomba/eshik rasmlari + GPS, tomonlar rasmlari va izohlari (`dispute_notes`), vaqt chizig'i, mijoz va kuryer xavf belgilari.
  Qaror: aybdor (restoran/kuryer/mijoz/platforma/hech kim), mijozga **darhol kompensatsiya fonddan** (`refunds` ro'yxatiga), aybdordan undirish (restoran → keyingi aktda ushlanadi, kuryer → jarima) → fondga.
  Kuryerga bosqichli chora (90 kunda aybi): 1 → ogohlantirish, 2 → jarima (`dispute_fine`=20 000), 3 → blok; qo'lda tanlash mumkin.
  **E'tiroz:** aybdor restoran/kuryer `appeal_days`=3 kun ichida bir marta; qabul qilinsa undirish, jarima, blok qaytariladi (mijoz kompensatsiyasi qoladi).
  Mijoz asossiz shikoyatda aybdor bo'lsa `false_claims`+1, 3 ta → avtomatik qora ro'yxat.
- **Qaytarishlar:** `refund_due` buyurtmalar (summa = to'langan − qarz) va nizo kompensatsiyalari; Payme/Click kabinetidan qaytarib, panelda belgilanadi.
- **Qora ro'yxat** (`blacklist`, telefon + tur): mijoz/kuryer kira olmaydi, SMS ham yuborilmaydi, sessiyalar o'chadi. **Xavf belgilari:** mijoz (olmagan, qarz, asossiz shikoyat, ko'p shikoyat,
  kompensatsiya >30%, ko'p bekor), kuryer (no-show ulushi ≥15%, voz kechish, nizolarda aybdor, past reyting). Restoran doskasida yangi buyurtmada mijoz xavfi ko'rinadi.
- **Statistika:** buyurtmalar, GMV, komissiya, o'rtacha chek, kuryer to'lovlari, fond, qaytarishlar, nizolar, yangi mijozlar, vaqtlar (jami/tayyorlash/kutish/yo'l), kunlar, bizneslar, kuryerlar samaradorligi.
- **Platforma jurnali** (`platform_log`): akt, to'lov, nizo qarori, e'tiroz, qora ro'yxat, qaytarish.
- Yangi jadvallar: `settlements`, `biz_adjustments`, `disputes`, `dispute_notes`, `refunds`, `blacklist`, `platform_log`. Ustunlar: `app_users.debt/false_claims`, `delivery_orders.debt_amount/settlement_id`.
  Sozlamalar: `dispute_days`, `appeal_days`, `dispute_fine`. Lokal serverli restoran nizolarni bulutdagi nusxadan yozadi (`/api/delivery/disputes` mirror cheklovidan ozod).
- Testlar: hammasi yashil — flow 39, office 23, staff 29, tenant 34, sync 26, delivery 55, delivery_sync 18, courier 67, platform 64. Brauzerda platforma, mijoz, kuryer, POS ekranlari xatosiz.

### 8-etap qarorlari
- Kafolat fondi manfiyga tushishi mumkin (platforma qoplaydi) — statistikada qizil ko'rinadi.
- Kompensatsiya faqat pul qaytarish (keshbek/promokod emas). Qaytarish qo'lda belgilanadi.
- Mijoz shikoyatida aybdor oldindan tanlanmaydi — platforma xodimi isbotlarga qarab tanlaydi.

### 8-etap ochiq qolganlari
- Restoranga va kuryerga avtomatik pul o'tkazish (bank/marketplace shartnomasi) — hozir akt + qo'lda to'lov.
- Payme/Click orqali avtomatik qaytarish (merchant hisobi kerak).
- Nizo bo'yicha SMS/push xabar — SMS provayder ulanganda.
- Oferta: kompensatsiya, undirish va qora ro'yxat qoidalari yurist bilan yozilishi kerak.
- Ko'p filialli ega uchun barcha filiallar aktlari bir joyda (ega kabineti) — keyin.

## 8.1 — mijoz ilovasi dizayni
- Mijoz ilovasi o'z yorug' temasiga o'tdi (`public/app/app.css` ichida tokenlar qayta belgilangan; telefon qorong'i rejimda bo'lsa — qorong'i variant). POS va kuryer dizayni o'zgarmadi.
- Bosh sahifa: salomlashuv, qidiruv (nom/tavsif/tur bo'yicha, klientda), banner, rangli toifa plitkalari (har biri joylar soni bilan), katta joy kartalari (rangli muqova, vaqt, yetkazish narxi, ochiq/yopiq).
- Yangi joy turlari: milliy, pizza, sushi, nonvoyxona, dokon (server `delivery.js` PLACE_TYPES, POS `public/delivery.js` PLACE_TYPES, mijoz `public/app/client.js` TYPES — uchalasi bir xil bo'lishi kerak). Dorixona va Gullar "tez kunda" plitkasi sifatida.
- Joy sahifasi: rangli muqova, mahsulot rasmisiz bo'lsa joy turi rangidagi fon.
- Toifa plitkalarida o'zimiz chizgan SVG ikonkalar (`public/app/icons.js`), joy kartasi va sahifasi muqovasida turga qarab haqiqiy foto (`public/app/img/places/<tur>.jpg`, Pexels litsenziyasi, manbalar `public/app/img/CREDITS.md`). Server `.jpg/.webp` MIME turlarini beradi.
- Keyin: restoran o'z muqova rasmini yuklashi (hozir tur bo'yicha umumiy foto).

## 9-etap rejasi (keyingi)
- Dorixona (faqat retseptsiz, litsenziya va yurist xulosasidan keyin), do'konlar (og'irlik/dona, almashtirish), kechki chegirma moduli (ortgan taom).
