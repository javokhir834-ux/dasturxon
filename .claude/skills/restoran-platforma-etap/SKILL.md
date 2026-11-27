---
name: "restoran-platforma-etap"
description: "Use when Javohir says 'keyingi etapga o't' (or 'keyingi etap', 'davom et') about his restaurant POS + delivery platform (Dasturxon) — build the next roadmap stage fully."
---

# Restoran platformasi — keyingi etapga o'tish

Javohir umumiy (bitta restoranga bog'lanmagan) platforma quryapti: avval iiko darajasidagi restoran tizimi, keyin Uzum Tezkor kabi yetkazib berish (bitta ilova: mijoz, biznes, kuryer, admin). Ishchi nom: **Dasturxon** (nomni keyin o'zi tanlaydi — APP_NAME sozlamada). Dizayn hamma joyda bitta, umumiy, o'zbek tilida.

U "keyingi etapga o't" desa — savol bermay, keyingi etapni TO'LIQ qur. Qarorlar unga topshirilgan: aqlli standartni tanla va javob oxirida qisqa ro'yxat qilib ayt.

## Tartib (har safar)
1. Loyiha — shu repo (GitHub: javokhir834-ux/dasturxon). Repo bo'lmasa: ulangan papka yoki u yuborgan oxirgi ZIP.
2. Loyiha ildizidagi `PROGRESS.md` ni o'qi: qaysi etap tugagan, qanday qarorlar qabul qilingan, ma'lum cheklovlar.
3. Keyingi etapni quyidagi yo'l xaritasidan ol. Task list tuz.
4. Mavjud arxitekturani buzmasdan qur (pastdagi qoidalar). Eski funksiyalar ishlashda davom etishi shart.
5. Test: serverni ishga tushir, to'liq oqimni API orqali sina, ekranlarni brauzerda ko'r (screenshot).
6. `PROGRESS.md` ni yangila (tugagan etap, yangi jadvallar/API, cheklovlar, keyingi etap).
7. Testlar: `bash tests/run_all.sh` (API) va `tests/ui*.py` (brauzer). Hammasi yashil bo'lsin. Keyin commit qilib repo'ga push qil (yangi branch emas — main, agar u boshqacha demasa). ZIP faqat u so'rasa. Javob: o'zbekcha, qisqa — nima qo'shildi, qanday ishga tushiriladi, nimani real hayotda sinash kerak.

## Arxitektura qoidalari
- Stack va qoidalar — loyiha ildizidagi `CLAUDE.md` ("Yangi funksiya qo'shish qoidalari"). Qisqasi: TypeScript (build yo'q), Fastify, Zod, `node:sqlite`;
  har etap = `src/modules/<nom>.ts` + `src/modules/index.ts` ga qator; frontend `public/` (vanilla JS); mobil — `mobile/` (Capacitor: mijoz, kuryer, biznes).
- Har jadvalda `business_id`. Pul — so'm (INTEGER), vaqt — ISO. Muhim amallar `audit_log` ga. UI matnlari o'zbek (lotin), dizayn umumiy.
- Etap tugashi: `npm run check` + `npm test` + kerakli `tests/ui*.py` yashil; `PROGRESS.md` yangilangan; mobil ilovalarga ta'sir qilsa `cd mobile && node build.mjs && node sync.mjs`.

## Yo'l xaritasi
- **1-etap — POS yadro:** zal/stollar (ko'chirish, birlashtirish), ofitsiant buyurtmasi (izoh, modifikatorlar), oshxona ekrani (sexlar bo'yicha) + printer, kassa (naqd/karta/Click/Payme, chek bo'lish, chegirma, xizmat haqi), smena ochish/yopish, menyu (kategoriya, narx, stop-list), rollar, audit log, fiskal adapter.
- **2-etap — Ofis:** ombor qoldiqlari, kirim/chiqim, texnologik kartalar (sotuvda masalliq avtomatik hisobdan chiqadi), inventarizatsiya, ta'minotchilar/xaridlar, tannarx va foyda, hisobotlar (sotuv, ABC, soatlar, ofitsiantlar).
- **3-etap — Xodimlar va mijozlar:** ish vaqti/smenalar, maosh va ofitsiant foizi, mijozlar bazasi, keshbek/sodiqlik, stol va banket bronlari (zaklad bilan), ega uchun Telegram hisobot, offline barqarorlik.
- **4-etap — Ko'p biznes va obuna:** filiallar, biznes ro'yxatdan o'tishi, obuna to'lovi → ishchi paneli ochilishi, ega xodimlarni o'zi yaratadi, alohida tariflar (POS va yetkazish alohida pullik).
- **5-etap — Bulutga ko'chish:** internetdagi server, lokal POS bilan sinxron (offline davom etadi), xavfsizlik. (Postgres — PROGRESS.md "Texnik qarz")
- **6-etap — Mijoz ilovasi:** bizneslar katalogi (restoran, fastfood; dorixona keyin), menyu, savat, Click/Payme, oldindan to'lov qoidalari: yangi mijoz 100% oldindan, ishonchli mijoz (5+ muvaffaqiyatli, 0 no-show) naqd mumkin, qisman oldindan to'lov 20–30%, restoran o'zi sozlaydi; mahsulotda "qaytarilmaydi/qaytariladi" belgisi; qaytarilmaydigan qimmat buyurtma faqat 100% oldindan; naqd limit.
- **7-etap — Kuryer ilovasi:** ro'yxat (MyID, hujjatlar, test, sinov davri), buyurtma taqsimlash (taksi kabi), GPS, 4 xonali topshirish kodi, plomba rasmi, naqd limit va kunlik hisob, depozit, reyting (4.5 dan past — ogohlantirish/blok), darajalar va bonuslar, no-show tartibi (qo'ng'iroq + 10 daqiqa taymer + GPS + rasm → kuryer haqini oladi, taom kuryerda qoladi).
- **8-etap — Platforma admin:** komissiya (masalan 12%), kafolat fondi (komissiyadan ~1%), nizolar (isbotlar: restoran/kuryer/mijoz rasmlari, GPS; aybdor jadvali; mijozga darhol kompensatsiya, aybdordan undirish; kuryerga bosqichli choralar, e'tiroz huquqi), umumiy qora ro'yxat, mijoz firibgarligidan himoya.
- **8.5 — Qayta qurish (tugagan):** TypeScript + Fastify + Zod, 3 mobil ilova (Capacitor), push xabarlar.
- **9-etap (tugagan) — Qo'shimcha toifalar:** dorixona (faqat retseptsiz, yuristdan keyin), do'konlar; kechki chegirma moduli (ortgan taom).
- **10-etap (tugagan) — Ishga chiqarish:** huquqiy sahifalar, akkauntni o'chirish, Eskiz SMS, monitoring, tashqi zaxira, imzolangan AAB (docs/LAUNCH.md). Keyin — pilot va 11-etap (PROGRESS.md).
- **Keyin (yuk oshganda):** PostgreSQL (bulut), WebSocket, iOS App Store.

## Eslatmalar
- Javohir o'zbekcha, qisqa javob yoqtiradi; token tejash muhim.
- Huquqiy bloklar (fiskal, to'lovni bo'lish/marketplace, dorixona litsenziyasi, oferta) — kodga tayyor joy qoldir, real ulanishni u hal qilgach qil; har etap oxirida ochiq qolganini ayt.