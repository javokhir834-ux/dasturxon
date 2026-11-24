# Bulutga o'rnatish (VPS)

Ikki xil ishlatish mumkin:

| | Lokal server (restoranda) | Bulut server (internetda) |
|---|---|---|
| Qayerda | Restoran kompyuteri, `start.bat` | VPS, `https://pos.domeningiz.uz` |
| Internet uzilsa | Ishlayveradi | — |
| Kim uchun | Kassa, ofitsiant, oshxona | Ega (uydan), ro'yxatdan o'tish, platforma paneli |

**Tavsiya etilgan sxema:** har bir restoranda lokal server ishlaydi va bulutga sinxronlanadi.
Kichik kafe internetiga ishonsa, to'g'ridan-to'g'ri bulutdan ham ishlashi mumkin (lokal serversiz).

## 1. Kerakli narsalar
- **VPS:** Ubuntu 22.04 yoki 24.04, 1 vCPU, 1–2 GB RAM, 20 GB disk. Bu 50–100 ta restoranga yetadi.
- **Domen:** masalan `pos.domeningiz.uz`. DNS'da **A yozuvi** VPS IP manziliga yo'naltirilgan bo'lishi kerak.
- VPS ga SSH orqali kirish (`ssh root@IP`).

## 2. O'rnatish (bir marta, ~5 daqiqa)
Kompyuteringizdan ZIP'ni VPS ga yuboring va o'rnating:

```bash
scp Dasturxon-POS-5-etap.zip root@VPS_IP:/root/
ssh root@VPS_IP
apt-get install -y unzip && unzip -o Dasturxon-POS-5-etap.zip
sudo bash dasturxon/deploy/setup-ubuntu.sh pos.domeningiz.uz
```

Skript nimalar qiladi:
- Node.js 22 ni o'rnatadi.
- Caddy'ni o'rnatadi (HTTPS sertifikatini o'zi oladi va yangilab turadi).
- `dasturxon` nomli tizim xizmatini yaratadi: server o'chib qolsa o'zi qayta yonadi, VPS qayta yonganda ham avtomatik ishga tushadi.
- Faervol ochadi (faqat 22, 80, 443 portlar).
- Kunlik zaxira nusxani sozlaydi: `/var/backups/dasturxon`, 30 kun saqlanadi.

Oxirida manzillar va **platforma paroli** chiqadi. Parol `/root/dasturxon-platforma-parol.txt` faylida ham saqlanadi.

> ⚠️ SSH standart bo'lmagan portda bo'lsa, skriptni ishga tushirishdan oldin `ufw allow PORT/tcp` qiling. Aks holda faervol sizni uzib qo'yadi.

## 3. Tekshirish
- `https://pos.domeningiz.uz/#platform` — platforma paneli (parol bilan).
- `https://pos.domeningiz.uz/#register` — restoran ro'yxatdan o'tishi.
- Loglar: `journalctl -u dasturxon -f`. Holat: `systemctl status dasturxon`.

## 4. Restorandagi lokal serverni bulutga ulash
1. Ega bulutda `#owner` kabinetiga kiradi → filial → **"Lokal serverni ulash"**. Bulut manzili va ulash kaliti chiqadi (kalit faqat bir marta ko'rsatiladi).
2. Restoran kompyuterida: POS → Boshqaruv → Sozlamalar → **Bulut sinxronizatsiya** → manzil va kalitni kiriting → **Ulash**.
3. Birinchi marta butun baza (menyu, ombor, xodimlar, tarix) yuboriladi. Keyin har bir o'zgarish bir necha soniyada yetib boradi.

Natijada:
- Ega kabinetida filialning tushumi, smena holati va oxirgi sinxron vaqti ko'rinadi.
- Admin yoki menejer bulut manziliga **o'z PINi bilan** kirib, barcha hisobotlarni uydan ko'radi. Bulutdagi nusxa faqat ko'rish uchun, savdo restoranda qiladi.
- Internet uzilsa kassa to'xtamaydi: o'zgarishlar navbatda kutadi va internet qaytganda o'zi yuboriladi (Sozlamalar'da "Navbatda: N").
- Restoran kompyuteri buzilsa ham ma'lumot yo'qolmaydi, bulutda nusxasi bor.

## 5. Yangilash
```bash
unzip -o Dasturxon-POS-yangi.zip && sudo bash dasturxon/deploy/update.sh
```
Yangilashdan oldin zaxira nusxa olinadi. `.env` va ma'lumotlar saqlanadi, baza o'zi yangilanadi.

## 6. Zaxira nusxadan tiklash
```bash
sudo systemctl stop dasturxon
sudo cp /var/backups/dasturxon/2026-11-24.sqlite /var/lib/dasturxon/db.sqlite
sudo rm -f /var/lib/dasturxon/db.sqlite-wal /var/lib/dasturxon/db.sqlite-shm
sudo chown dasturxon:dasturxon /var/lib/dasturxon/db.sqlite && sudo systemctl start dasturxon
```
**Tavsiya:** zaxira nusxalarni boshqa joyga ham ko'chiring (masalan, `rclone` bilan Google Drive'ga, har kuni).

## 7. Xavfsizlik
- Hamma narsa HTTPS orqali ishlaydi (HSTS yoqilgan), server faqat `127.0.0.1` da tinglaydi, tashqaridan faqat Caddy orqali kiriladi.
- Xavfsizlik sarlavhalari yoqilgan: CSP, X-Frame-Options, nosniff.
- So'rovlar soni IP bo'yicha cheklangan. PIN, kabinet va platforma kirishida noto'g'ri urinishlar bloklanadi.
- Parollar scrypt bilan saqlanadi. Ulash kaliti va sessiyalar faqat xesh ko'rinishida saqlanadi.
- Real-time ulanish token o'rniga bir martalik chipta ishlatadi.
- Platforma parolini panel → Sozlamalar'da almashtiring. `.env` faylidagi `PLATFORM_PASSWORD` qayta ishga tushganda yana o'rnatiladi, shuning uchun o'zgartirgandan keyin o'sha qatorni o'chiring.
