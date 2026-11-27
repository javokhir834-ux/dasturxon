# FastHub Uz — ishga chiqarish qo'llanmasi (10-etap)

Tayyorlikni platforma panelida ko'ring: **#platform → 🚀 Ishga chiqarish**. U yerdagi ro'yxat (SMS, push, to'lov, rekvizitlar, zaxira, ogohlantirish) shu hujjat qadamlari bilan yashil bo'ladi.

## 1. Huquqiy va biznes (kod emas — Javohir hal qiladi)
- **Yuridik shaxs:** YaTT yoki MChJ (Payme/Click merchant, Eskiz shartnomasi, Play'dagi tashkilot hisobi uchun kerak).
- **Shaxsga doir ma'lumotlar:** O'zbekiston qonuni bo'yicha fuqarolar ma'lumotlari O'zbekiston hududidagi serverda saqlanadi —
  VPS va zaxira serverni mahalliy provayderdan oling. Ma'lumotlar bazasini davlat reestrida ro'yxatdan o'tkazish talabini yurist bilan aniqlang.
- **Yurist ko'rib chiqsin:** `public/legal/privacy.html` (maxfiylik siyosati), `public/legal/terms.html` (oferta), dorixona bo'limi, kuryer bilan munosabat (mustaqil ijrochi).
- **Rekvizitlar:** panel → Ishga chiqarish → Rekvizitlar (kompaniya, STIR, manzil, telefon, e-pochta, sana) — uchala sahifaga avtomatik qo'yiladi.
- **Fiskal:** reestrdagi virtual kassa provayderini tanlash → `src/services/fiscal.ts` ga ulanadi (alohida ish).

## 2. Server (VPS, Ubuntu 24.04)
```bash
git clone https://github.com/javokhir834-ux/dasturxon.git && cd dasturxon
sudo bash deploy/setup-ubuntu.sh api.fasthub.uz      # Node 22, Caddy (HTTPS), systemd, faervol, cron
sudo nano /opt/dasturxon/.env                        # pastdagi kalitlar
sudo systemctl restart dasturxon
```
Yangilash: `git pull && sudo bash deploy/update.sh`. Domen DNS: `A api.fasthub.uz → VPS IP` (Caddy sertifikatni o'zi oladi).

| Kalit (.env) | Qayerdan |
|---|---|
| `SMS_MODE=eskiz`, `ESKIZ_EMAIL`, `ESKIZ_PASSWORD`, `ESKIZ_FROM` | my.eskiz.uz → shartnoma. **Shablon:** `FastHub tasdiqlash kodi: {kod}` ni tasdiqlating, aks holda SMS ketmaydi |
| `PUSH_MODE=fcm`, `FCM_SERVICE_ACCOUNT=/opt/dasturxon/firebase.json` | Firebase → Service accounts → private key (`mobile/README.md`) |
| `PAYME_MERCHANT_ID`, `PAYME_KEY` (`PAYME_TEST` ni olib tashlang) | business.payme.uz, endpoint: `https://DOMEN/api/pay/payme` |
| `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY` | merchant.click.uz, prepare/complete: `https://DOMEN/api/pay/click/...` |
| `ALERT_TG_TOKEN`, `ALERT_TG_CHAT` | @BotFather → bot; chat ID — botga yozib, `getUpdates` dan |
| `BACKUP_REMOTE`, `BACKUP_PASSPHRASE` | 2-server (O'zbekistonda): `rclone config` → sftp → nom `uzbackup`; parolni **alohida joyda** saqlang |
| `REVIEW_PHONE`, `REVIEW_CODE` | Play tekshiruvchisi uchun o'ylab topilgan raqam va 5 xonali kod (SMS ketmaydi) |

**Monitoring:** `deploy/healthcheck.sh` (har 2 daqiqa) javob bo'lmasa xizmatni qayta ishga tushiradi va Telegramga yozadi; server xatolari ham
Telegramga keladi (5 daqiqada ko'pi bilan 1 ta). Qo'shimcha: uptimerobot.com → `https://DOMEN/api/health` (server butunlay o'chsa ham xabar beradi).
**Zaxira:** server har kuni `data/backups` ga oladi, `deploy/backup-offsite.sh` (03:40) siqib, shifrlab 2-serverga yuboradi. Oyiga 1 marta tiklashni sinang:
`openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in fasthub-SANA.sqlite.gz.enc | gunzip > db.sqlite`.
**Yuklama sinovi:** `node tests/load.cjs https://DOMEN 50 30` (vaqtincha `RATE_LIMIT=100000`). Mo'ljal: p95 < 300 ms, 0 xato.

## 3. Mobil ilovalar → Google Play
1. `mobile/brand.json`: `"server": "https://api.fasthub.uz"` (mijoz/kuryer server so'ramaydi), `"push": true`. Paket ID lar: `uz.fasthub.app|courier|business` — **chiqqandan keyin o'zgarmaydi**.
2. Yuklash kaliti (bir marta, yo'qotmang — nusxasini xavfsiz joyda saqlang):
   `keytool -genkeypair -v -keystore upload.jks -alias fasthub -keyalg RSA -keysize 2048 -validity 10000`
3. GitHub → Settings → Secrets: `ANDROID_KEYSTORE_BASE64` (`base64 -w0 upload.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS=fasthub`, `GOOGLE_SERVICES_JSON`.
   Har push da Actions → "Android ilovalar" → `*-aab` artefakti (imzolangan, versionCode avtomatik oshadi).
4. play.google.com/console ($25) → 3 ta ilova. Play App Signing yoqilgan holda AAB ni **Internal testing** ga yuklang → 5–10 tester → keyin Closed → Production.
   (Yangi shaxsiy hisoblarda Production'dan oldin 12+ tester bilan 14 kun yopiq sinov talab qilinadi — tashkilot hisobida yo'q.)

### Play Console maydonlari
| Maydon | Qiymat |
|---|---|
| Privacy policy | `https://DOMEN/legal/privacy` |
| Account deletion URL | `https://DOMEN/legal/delete` (ilova ichida ham: Mijoz → Buyurtmalarim, Kuryer → Hisob) |
| App access (login) | "Telefon + SMS kod": `REVIEW_PHONE` va `REVIEW_CODE` ni yozing |
| Ads | Yo'q |
| Content rating | Hammaga (taom yetkazish; dorixona — faqat retseptsiz) |
| Target audience | 18+ (kuryer), 16+ (mijoz) |
| Kategoriya | Food & Drink (mijoz), Business (kuryer, biznes) |

### Data safety (ma'lumotlar xavfsizligi) javoblari
- Ma'lumot yig'iladi: **ha**; uchinchi shaxslarga **sotilmaydi**; uzatishda shifrlanadi (HTTPS): **ha**; foydalanuvchi o'chirishni so'ray oladi: **ha**.
- **Mijoz ilovasi:** Telefon raqam, Ism (hisob, xizmat) · Taxminiy va aniq joylashuv (ixtiyoriy, yetkazish manzili) · Xaridlar tarixi (xizmat, firibgarlikdan himoya) ·
  Rasmlar (shikoyatga ilova, ixtiyoriy) · Qurilma ID / push token (bildirishnoma). To'lov ma'lumoti — Payme/Click'da, ilovada yig'ilmaydi.
- **Kuryer ilovasi:** yuqoridagilar + **aniq joylashuv fonda** (faqat "Ishdaman" yoqilganda; buyurtma taqsimlash, mijozga kuzatuv) ·
  Rasmlar (pasport, selfi, guvohnoma — shaxsni tekshirish; yetkazish isboti) · Moliyaviy ma'lumot (daromad, naqd hisob).
- **Biznes ilovasi:** Ism, telefon (xodim), ilova faoliyati (kassa jurnali).
- Ma'lumot kimga beriladi (Play "shared" ta'rifi): restoran/do'kon va kuryer — buyurtmani bajarish uchun (xizmat ko'rsatish — "shared" hisoblanmaydi).

### Fonda joylashuv deklaratsiyasi (faqat kuryer)
Play Console → App content → Location permissions: "Kuryer 'Ishdaman' rejimida bo'lganda ilova yopiq bo'lsa ham joylashuvi yaqin buyurtmalarni taklif qilish
va mijozga kuryer qayerdaligini ko'rsatish uchun yuboriladi. Rejim o'chirilsa — yuborilmaydi." + 30 soniyalik video: kirish → Ishdaman → bildirishnomada
"joylashuv ishlatilmoqda" → ilovani yopish → buyurtma taklifi kelishi.

### Do'kon sahifasi matni (namuna)
- **FastHub Uz** — "Navoiydagi restoran, kafe, do'kon va dorixonalardan tez yetkazib berish. Oldindan to'lov Payme/Click, kuryerni xaritada kuzating, 4 xonali kod bilan xavfsiz topshirish, muammo bo'lsa — kafolat fondidan kompensatsiya."
- **FastHub Kuryer** — "O'z vaqtingizda ishlang: yaqin buyurtmalar, har yetkazish uchun haq, kunlik hisob, daraja va bonuslar."
- **FastHub Biznes** — "Restoran va do'kon uchun POS: stollar, oshxona ekrani, kassa, ombor, yetkazib berish buyurtmalari."
Rus tilidagi tavsifni ham qo'shing (Play'da alohida til).

## 4. iOS (keyin)
Mac + Xcode, Apple Developer ($99/yil) — `mobile/README.md`. App Store ham akkauntni ilova ichida o'chirishni talab qiladi — tayyor.

## 5. Pilot (Navoiy)
- 2–3 restoran + 1 do'kon, 5–10 kuryer, 2 hafta. Har kuni: panel → Statistika (vaqtlar, rad etish), Nizolar, Ishga chiqarish (xatolar, zaxira).
- Kuryerlar bilan birinchi kun birga yuring: GPS, kod bilan topshirish, no-show tartibi.
- Har hafta bitta tuzatish relizi (`deploy/update.sh` + Play Internal testing).
