# Dasturxon POS — restoran boshqaruv tizimi

Restoranning o'z kompyuterida ishlaydigan server. Planshet va telefonlar Wi-Fi orqali ulanadi.
Internet uzilsa ham ishlayveradi, chunki hammasi restoran ichidagi tarmoqda.

## Ishga tushirish

1. **Node.js 22 LTS** (22.18 yoki yangi) o'rnating: https://nodejs.org (bir marta).
2. Windows'da `start.bat` faylini ikki marta bosing. Brauzer o'zi ochiladi.
   Boshqa tizimlarda: `npm install` (bir marta), keyin `npm start`.
3. Oynada **"Planshet/telefon: http://192.168.x.x:8080"** degan manzil chiqadi.
   Ofitsiant telefonlari va oshxona planshetida shu manzilni oching. Hammasi bitta Wi-Fi'da bo'lishi kerak.

Ma'lumotlar `data/db.sqlite` faylida saqlanadi. Har kuni shu faylning nusxasini oling (zaxira).

## Biznes kodi va bir nechta restoran

- Har bir biznesning **6 xonali kodi** bor (Boshqaruv → Sozlamalar'da ko'rinadi). Yangi planshet yoki telefon birinchi marta shu kod bilan ulanadi,
  keyin faqat PIN so'raladi. Serverda bitta biznes bo'lsa, kod so'ralmaydi.
- **Yangi biznes:** `http://SERVER:8080/#register` — restoran o'zi ro'yxatdan o'tadi, 14 kun bepul sinov.
- **Ega kabineti:** `/#owner` — telefon va parol bilan. Barcha filiallar tushumi, smena holati, obuna; yangi filial qo'shish
  (menyu va texkartalar nusxasi bilan), admin PINini tiklash.
- **Platforma paneli:** `/#platform` — siz uchun (platforma egasi). Parol birinchi ishga tushishda `data/platforma-parol.txt` faylida bo'ladi
  (yoki `PLATFORM_PASSWORD` muhit o'zgaruvchisi bilan beriladi). Bizneslar, obunani uzaytirish, bloklash, narxlar, daromad.
- **Obuna:** muddat tugagach bir necha kun imtiyozli davr bo'ladi, keyin tizim **faqat ko'rish rejimiga** o'tadi (sotuv to'xtaydi,
  hisobotlar ko'rinadi, smenani yopish mumkin). To'lov qayd etilishi bilan darhol tiklanadi.

## Bulut (internetdagi server)

Egaga uydan ko'rish, yangi restoranlar ro'yxatdan o'tishi va restoran kompyuterining zaxirasi uchun tizim VPS'ga o'rnatiladi.
To'liq qo'llanma **DEPLOY.md** faylida: bitta buyruq bilan Node, HTTPS, avtomatik qayta ishga tushish va zaxira sozlanadi.
Restorandagi kompyuter bulutga **Boshqaruv → Sozlamalar → Bulut sinxronizatsiya** orqali ulanadi. Internet uzilsa kassa to'xtamaydi.

## Yetkazib berish (mijoz ilovasi)

- **Mijoz ilovasi:** `https://SAYT/app` — telefonda ochiladi. Mijoz joyni tanlaydi, savatga qo'shadi, manzil yozadi, SMS kod bilan kiradi va to'laydi.
- **Restoranda yoqish:** platforma "Yetkazib berish" obunasini yoqadi → admin **Boshqaruv → Yetkazib berish** da "Ilovada ko'rinsin" ni belgilaydi,
  manzil, narx va to'lov qoidalarini sozlaydi. **Menyu** da har taom uchun "ilovada sotiladi", "qaytarib bo'lmaydi" va rasm.
- **Kassada:** "🛵 Yetkazish" bo'limi. Yangi buyurtma kelganda ovoz chiqadi. Qabul qiling (tayyorlash vaqtini tanlang) → taom oshxonaga o'zi ketadi →
  oshxona "tayyor" qilganda buyurtma "Tayyor" ga o'tadi → "Kuryerga berildi" → "Yetkazildi" (chek o'zi yopiladi). Smena ochiq bo'lishi kerak.
- **To'lov qoidasi:** yangi mijoz to'liq oldindan to'laydi; 5 ta muvaffaqiyatli buyurtmadan keyin naqd ochiladi (sozlanadi). Buyurtmani olmagan mijoz keyin faqat oldindan to'laydi.
- **Onlayn to'lov kalitlari** (`.env`): `PAYME_MERCHANT_ID`, `PAYME_KEY`, `PAYME_TEST=1`; `CLICK_SERVICE_ID`, `CLICK_MERCHANT_ID`, `CLICK_SECRET_KEY`.
  Kalitlar bo'lmasa faqat **sinov to'lovi** ishlaydi. Payme kabinetida endpoint: `https://SAYT/api/pay/payme`; Click: `https://SAYT/api/pay/click/prepare` va `/complete`.
- **SMS:** `SMS_MODE=test` (standart) — kod ekranda ko'rinadi, faqat sinov uchun. Haqiqiy ishga tushirishda SMS provayder ulanadi.

## Kuryerlar

- **Kuryer ilovasi:** `https://SAYT/courier` — kuryer telefon bilan ro'yxatdan o'tadi, hujjat rasmlari va qoidalar testini topshiradi.
- **Platforma paneli → 🛵 Kuryerlar:** arizani ko'rib tasdiqlang (sinov davri boshlanadi), depozit va har kungi naqdni shu yerda qayd eting.
- **Restoran:** Boshqaruv → Yetkazib berish → "Kim yetkazadi: Platforma kuryerlari" va **"📍 Shu yerni belgilash"** (restoran joylashuvi).
  Buyurtmani qabul qilgach eng yaqin kuryerga avtomatik taklif ketadi. Kuryer plomba rasmini olib oladi, mijozdagi 4 xonali kod bilan topshiradi, chek o'zi yopiladi.
- Kuryer olgan naqd hisobotda "Kuryer naqdi" bo'lib turadi — u kassaga emas, platforma orqali restoranga keladi.

## Mobil ilovalar (Android, iOS)

3 ta ilova: **Mijoz**, **Kuryer**, **Biznes** (POS planshet/telefonda). APK — GitHub Actions'da avtomatik yig'iladi.
Qanday yuklab olish, nom/logo almashtirish, push xabarlar va Google Play — **mobile/README.md**.

## Namuna PIN kodlar

| Rol | PIN | Nima qila oladi |
|---|---|---|
| Admin | 1111 | Hammasi: menyu, stollar, xodimlar, sozlamalar, jurnal |
| Kassir | 2222 | Smena, to'lov, chegirma, bekor qilish, kassa harakatlari |
| Ofitsiant | 3333 | Buyurtma ochish, taom qo'shish, oshxonaga yuborish, pre-chek |
| Oshpaz | 4444 | Oshxona ekrani, stop-list |

Qo'shimcha rollar (Boshqaruv → Xodimlar'da yaratiladi): **Menejer** — Boshqaruvdan tashqari hamma narsa, **Omborchi** — faqat ombor.

**Ishga tushirgandan keyin Boshqaruv → Xodimlar bo'limida PINlarni albatta almashtiring.**

## Bir kunlik ish tartibi

1. **Kassir** kiradi → *Kassa va smena* → boshlang'ich naqd pulni kiritib smenani ochadi.
2. **Ofitsiant** stolni bosadi → mehmonlar soni → taomlarni tanlaydi → **Oshxonaga yuborish**.
   Taomdagi `⋯` tugmasi orqali modifikator ("piyozsiz") va oshxonaga izoh qo'shiladi.
3. **Oshxona ekrani** taomlarni sexlar bo'yicha ko'rsatadi: Yangi → Tayyorlanmoqda → Tayyor.
   10 daqiqadan oshsa sariq, 20 daqiqadan oshsa qizil bo'ladi.
4. Taom tayyor bo'lsa, ofitsiantga zal xaritasida **"Tayyor taom"** belgisi chiqadi.
5. Mehmon hisob so'rasa → **Pre-chek**. Shundan keyin ofitsiant buyurtmani o'zgartira olmaydi.
6. **Kassir** to'lov qabul qiladi: naqd, karta, Click, Payme yoki aralash. Qaytim avtomatik hisoblanadi.
7. Kun oxirida kassir pulni sanab **Smenani yopish** → Z-hisobot. Kutilgan va sanalgan pul farqi ko'rinadi.

## O'g'irlikdan himoya

- Oshxonaga yuborilgan taomni ofitsiant o'chira olmaydi, faqat kassir yoki admin **sabab bilan** bekor qiladi.
- Chegirma faqat kassir yoki admin tomonidan, sabab bilan beriladi.
- Pre-chekdan keyin buyurtmani o'zgartirib bo'lmaydi.
- Har bir bekor qilish, chegirma, to'lov va o'zgarish **Jurnal**ga yoziladi (Boshqaruv → Jurnal).
- Z-hisobotda bekor qilingan taomlar va kassadagi pul farqi ko'rsatiladi.
- PIN 5 marta noto'g'ri kiritilsa, 30 soniyaga bloklanadi.

## Ombor va hisobotlar (admin)

- **Ombor → Qoldiqlar:** har bir masalliq qancha qolgani, o'rtacha narxi va summasi. Minimaldan kam qolsa "kam qoldi" belgisi.
- **Texnologik kartalar:** har bir taom uchun masalliqlar (1 porsiya). Taom sotilganda shu masalliqlar ombordan **avtomatik** chiqadi.
  Ro'yxatda har bir taomning tannarxi va marjasi ko'rinadi. Xamir, qiyma kabi yarim tayyor mahsulotlarning ham kartasi bo'ladi.
- **Kirim:** ta'minotchidan kelgan mahsulot (nakladnoy). Narx kiritilganda masalliqning o'rtacha narxi o'zi yangilanadi.
- **Hisobdan chiqarish:** buzilgan, xodimlar ovqati va h.k., sababi bilan.
- **Inventarizatsiya:** omborni sanab, haqiqiy qoldiqni kiritasiz. Kamomad yoki ortiqcha summasi bilan ko'rinadi.
- **Ta'minotchilar:** kimdan qancha olingan, qancha to'langan, qancha qarz. Kassadan to'lansa, smenada chiqim bo'lib yoziladi.
- **Hisobotlar:** tushum, tannarx, yalpi foyda, kunlar va soatlar grafigi, ofitsiantlar, kategoriyalar, ABC tahlil.

Namuna ma'lumotlarda masalliqlar, texkartalar va boshlang'ich qoldiq bor. O'zingizning restoraningiz uchun ularni tahrirlang.

## Xodimlar, mijozlar va bronlar

- **Ish vaqti:** har bir xodim sarlavhadagi **"Ishga keldim"** tugmasini bosadi, ketishda yana bosadi. Menejer Xodimlar bo'limida ko'radi va tuzatadi.
- **Maosh:** Boshqaruv → Xodimlar'da har kimga stavka (soatbay yoki oylik) va foiz (sotuvdan yoki xizmat haqidan) belgilanadi.
  Xodimlar → Maosh'da hisoblangan, to'langan va qoldiq ko'rinadi; avans va maosh shu yerdan beriladi.
- **Mijozlar:** buyurtmada **"Mijoz biriktirish"** → telefon raqam. Mijoz bazaga o'zi qo'shiladi, to'lovdan keyin keshbek (standart 5%) yig'iladi
  va keyingi safar **Bonus** bilan to'lash mumkin. Doimiy mijozga menejer shaxsiy chegirma beradi, u avtomatik qo'llanadi. Tug'ilgan kuni yaqin bo'lsa 🎂 belgisi chiqadi.
- **Bronlar:** stol yoki banket, zaklad bilan. Zalda bron qilingan stolda vaqti ko'rinadi. Mehmon kelganda **"Keldi"** bosiladi,
  buyurtma o'zi ochiladi, to'lovda zaklad avtomatik hisobga olinadi. Bekor qilinsa zakladni qaytarish mumkin.
- **Telegram:** Boshqaruv → Sozlamalar'da bot ulanadi. Har kuni belgilangan vaqtda va har smena yopilganda egaga hisobot keladi.
- **Zaxira nusxa:** baza har kuni va har smena yopilganda `data/backups` papkasiga avtomatik saqlanadi.

## Yangilash

Yangi versiyaga o'tishda eski `data` papkasini yangi papkaga ko'chiring (yoki yangi fayllarni eski papka ustiga yozing, `data`ni o'chirmang).
Baza birinchi ishga tushishda avtomatik yangilanadi, eski ma'lumotlar saqlanadi.

## Printerlar

- **Oshxona printerlari:** Boshqaruv → Sexlar va printerlar → printer IP manzili (masalan `192.168.1.50`).
  Taom yuborilganda o'z sexining printeriga avtomatik chiqadi (ESC/POS, port 9100).
- **Chek printeri:** Boshqaruv → Sozlamalar. Bo'sh qoldirilsa, chek brauzer orqali chop etiladi (80 mm).

## Fiskal chek

Qonun bo'yicha chek Davlat reestridagi onlayn-NKM yoki virtual kassa orqali, har bir taomning
**MXIK kodi** bilan berilishi kerak. Tizimda taomlarga MXIK kodi kiritiladigan joy va `fiscal.js` adapteri tayyor.
Provayder tanlangach, shu adapterga ulanadi. Hozircha rejim "O'chiq": restoran mavjud onlayn kassasidan foydalanadi.
