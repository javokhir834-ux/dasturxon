#!/usr/bin/env bash
# Dasturxon — bulut serverni o'rnatish (Ubuntu 22.04 / 24.04).
# Ishlatish:  sudo bash deploy/setup-ubuntu.sh pos.sizningdomen.uz
# Qayta ishga tushirish xavfsiz: mavjud .env va ma'lumotlar saqlanadi.
set -euo pipefail

DOMAIN="${1:-}"
[ -z "$DOMAIN" ] && { echo "Ishlatish: sudo bash deploy/setup-ubuntu.sh pos.sizningdomen.uz"; exit 1; }
[ "$(id -u)" -eq 0 ] || { echo "sudo bilan ishga tushiring"; exit 1; }

SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/dasturxon
DATA=/var/lib/dasturxon
echo "==> Paketlar"
apt-get update -y
apt-get install -y curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw rsync rclone openssl

echo "==> Node.js 22"
if ! command -v node >/dev/null || ! node -v | grep -qE '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> Caddy (avtomatik HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

echo "==> Foydalanuvchi va papkalar"
id dasturxon >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin dasturxon
mkdir -p "$APP" "$DATA" /var/backups/dasturxon
rsync -a --delete --exclude data --exclude .env --exclude deploy/local --exclude node_modules --exclude mobile "$SRC"/ "$APP"/
(cd "$APP" && npm ci --omit=dev --no-audit --no-fund)

if [ ! -f "$APP/.env" ]; then
  PW="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)"
  cat > "$APP/.env" <<ENV
MODE=cloud
HOST=127.0.0.1
PORT=8080
DATA_DIR=$DATA
PLATFORM_PASSWORD=$PW
RATE_LIMIT=900
# 10-etap: ishga chiqarish (docs/LAUNCH.md) — to'ldirib, keyin: systemctl restart dasturxon
# SMS_MODE=eskiz
# ESKIZ_EMAIL=
# ESKIZ_PASSWORD=
# PUSH_MODE=fcm
# FCM_SERVICE_ACCOUNT=/opt/dasturxon/firebase.json
# ALERT_TG_TOKEN=
# ALERT_TG_CHAT=
# BACKUP_REMOTE=uzbackup:fasthub
# BACKUP_PASSPHRASE=
# REVIEW_PHONE=
# REVIEW_CODE=
ENV
  echo "$PW" > /root/dasturxon-platforma-parol.txt
  chmod 600 /root/dasturxon-platforma-parol.txt
fi
chown -R dasturxon:dasturxon "$APP" "$DATA"
chmod 600 "$APP/.env"

echo "==> Xizmat (systemd)"
cp "$APP/deploy/dasturxon.service" /etc/systemd/system/dasturxon.service
systemctl daemon-reload
systemctl enable dasturxon >/dev/null
systemctl restart dasturxon

echo "==> HTTPS (Caddy)"
[ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile "/etc/caddy/Caddyfile.bak.$(date +%s)"
sed "s/__DOMAIN__/$DOMAIN/g" "$APP/deploy/Caddyfile.example" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> Faervol"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "==> Zaxira nusxa (03:40, shifrlab tashqariga) va holat tekshiruvi (har 2 daqiqa)"
chmod +x "$APP/deploy/backup-offsite.sh" "$APP/deploy/healthcheck.sh"
cat > /etc/cron.d/dasturxon-backup <<'CRON'
40 3 * * * root /opt/dasturxon/deploy/backup-offsite.sh >/var/log/fasthub-backup.log 2>&1
*/2 * * * * root /opt/dasturxon/deploy/healthcheck.sh >/dev/null 2>&1
CRON

sleep 2
if systemctl is-active --quiet dasturxon; then STATUS="ishlayapti"; else STATUS="XATO — journalctl -u dasturxon -n 50"; fi
echo
echo "=============================================="
echo " Dasturxon bulut server: $STATUS"
echo " Manzil:            https://$DOMAIN"
echo " Ro'yxatdan o'tish: https://$DOMAIN/#register"
echo " Ega kabineti:      https://$DOMAIN/#owner"
echo " Platforma paneli:  https://$DOMAIN/#platform"
echo " Platforma paroli:  $(cat /root/dasturxon-platforma-parol.txt 2>/dev/null || echo '.env faylida')"
echo " Loglar:            journalctl -u dasturxon -f"
echo "=============================================="
