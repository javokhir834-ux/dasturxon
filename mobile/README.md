# Mobil ilovalar (Capacitor 8)

| Ilova | Papka | Paket ID | Ochiladigan sahifa |
|---|---|---|---|
| Mijoz | `apps/mijoz` | `uz.dasturxon.app` | `/app` |
| Kuryer | `apps/kuryer` | `uz.dasturxon.courier` | `/courier` (fonda GPS) |
| Biznes (POS: restoran, kafe, dorixona) | `apps/biznes` | `uz.dasturxon.business` | POS |

Veb qismi `../public` dan olinadi — ilova va sayt bitta kod. Birinchi ochilishda **server manzili** so'raladi
(lokal restoran serveri `http://192.168.x.x:8080` yoki bulut `https://...`). Keyin o'zgartirish: kirish ekranida pastdagi **⚙ Server**.

## APK olish (kompyuterga hech narsa o'rnatmasdan)
1. Kod GitHub'ga push qilinsa, **Actions → "Android ilovalar"** o'zi ishga tushadi (yoki "Run workflow").
2. Tugagach (~5–8 daqiqa) pastda **Artifacts**: `mijoz-apk`, `kuryer-apk`, `biznes-apk` → yuklab oling, ZIP ichida `.apk`.
3. Telefonga o'tkazing → oching → "Noma'lum manbalardan o'rnatishga ruxsat" → o'rnating.

## O'z kompyuteringizda
```bash
cd mobile && npm install
node build.mjs && node sync.mjs        # veb qismi + native loyihalar + ruxsatlar
cd apps/kuryer && npx cap open android # Android Studio (yoki: cd android && ./gradlew assembleDebug)
```

## Nom / logo o'zgartirish
- `brand.json`: `name`, `idPrefix` (paket ID — Google Play'ga chiqishdan oldin tanlang, keyin o'zgarmaydi), `server` (standart server — bo'lsa so'ralmaydi).
- Logo: `apps/<ilova>/assets/icon-only.png` (1024×1024), `icon-foreground.png`, `splash.png` → `cd apps/<ilova> && npx capacitor-assets generate`.
- Paket ID o'zgarsa: `apps/<ilova>/android` va `ios` papkalarini o'chirib, `npx cap add android && npx cap add ios`, keyin `node sync.mjs`.

## Push xabarlar (Firebase, bepul)
1. console.firebase.google.com → loyiha → 3 ta Android ilova qo'shing (paket ID lar yuqorida) → `google-services.json` yuklab oling.
2. GitHub → Settings → Secrets → `GOOGLE_SERVICES_JSON` (fayl ichidagi matn). Bitta faylda 3 ilova ham bo'ladi.
3. `brand.json` → `"push": true`.
4. Serverda: Firebase → Project settings → Service accounts → "Generate new private key" → `.env`: `PUSH_MODE=fcm`, `FCM_SERVICE_ACCOUNT=/opt/dasturxon/firebase.json`.

## Google Play
- play.google.com/console → hisob ($25 bir marta) → har ilova uchun "Create app".
- Imzolangan AAB: `cd apps/<ilova>/android && ./gradlew bundleRelease` (oldin release kalit — `keytool`; kalitni yo'qotmang!).
- Kuryer ilovasi fonda joylashuv ishlatadi — Play'da "Location permission declaration" va video kerak bo'ladi.

## iOS
`apps/*/ios` tayyor (Swift Package Manager). Kerak: Mac + Xcode 16+, Apple Developer ($99/yil).
`cd apps/<ilova> && npx cap open ios` → Signing → Run. Push uchun Firebase'ga APNs kalitini qo'shing.
