#!/usr/bin/env bash
# Yangi versiyani o'rnatish (ma'lumotlar va .env saqlanadi):
#   unzip Dasturxon-POS-yangi.zip && sudo bash dasturxon/deploy/update.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "sudo bilan ishga tushiring"; exit 1; }
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/dasturxon
f=$(ls -t /var/lib/dasturxon/backups/db-*.sqlite 2>/dev/null | head -1 || true)
[ -n "$f" ] && cp "$f" "/var/backups/dasturxon/yangilashdan-oldin-$(date +%F-%H%M).sqlite"
rsync -a --delete --exclude data --exclude .env --exclude node_modules --exclude mobile "$SRC"/ "$APP"/
(cd "$APP" && npm ci --omit=dev --no-audit --no-fund)
chown -R dasturxon:dasturxon "$APP"
cp "$APP/deploy/dasturxon.service" /etc/systemd/system/dasturxon.service
# 10-etap: zaxirani tashqariga yuborish va holat tekshiruvi (eski o'rnatishlarda ham)
command -v rclone >/dev/null || apt-get install -y rclone >/dev/null
chmod +x "$APP/deploy/backup-offsite.sh" "$APP/deploy/healthcheck.sh"
cat > /etc/cron.d/dasturxon-backup <<'CRON'
40 3 * * * root /opt/dasturxon/deploy/backup-offsite.sh >/var/log/fasthub-backup.log 2>&1
*/2 * * * * root /opt/dasturxon/deploy/healthcheck.sh >/dev/null 2>&1
CRON
systemctl daemon-reload && systemctl restart dasturxon
sleep 2 && systemctl is-active --quiet dasturxon && echo "Yangilandi ✓" || { echo "XATO: journalctl -u dasturxon -n 50"; exit 1; }
