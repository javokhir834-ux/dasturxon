#!/usr/bin/env bash
# Kunlik zaxira nusxani siqib, shifrlab, boshqa serverga yuborish (cron: har kuni 03:40, root).
# Server o'zi har kuni data/backups/db-YYYY-MM-DD.sqlite yaratadi (src/modules/staff.ts) — bu skript eng oxirgisini oladi.
# .env dagi sozlamalar:
#   BACKUP_REMOTE=uzbackup:fasthub        rclone manzili (rclone config bilan yaratiladi). Shaxsiy ma'lumotlar qonuni bo'yicha
#                                          zaxira ham O'zbekistondagi serverda bo'lsin (masalan ikkinchi VPS — sftp).
#   BACKUP_PASSPHRASE=...                  shifrlash paroli (AES-256). Yo'qolsa — zaxirani ochib bo'lmaydi, alohida saqlang!
#   BACKUP_KEEP_DAYS=30                    lokal va tashqi nusxalar shuncha kun saqlanadi
#   ALERT_TG_TOKEN, ALERT_TG_CHAT          xato bo'lsa Telegramga xabar
# Natija panelda ko'rinadi: data/backups/offsite.json (Platforma → Ishga chiqarish).
# Tiklash: openssl enc -d -aes-256-cbc -pbkdf2 -pass env:BACKUP_PASSPHRASE -in F.sqlite.gz.enc | gunzip > db.sqlite
set -uo pipefail
APP=/opt/dasturxon
set -a; [ -f "$APP/.env" ] && . "$APP/.env"; set +a
DATA="${DATA_DIR:-/var/lib/dasturxon}"
LOCAL=/var/backups/dasturxon
KEEP="${BACKUP_KEEP_DAYS:-30}"
STATUS="$DATA/backups/offsite.json"
mkdir -p "$LOCAL"

alert() {
  [ -n "${ALERT_TG_TOKEN:-}" ] && [ -n "${ALERT_TG_CHAT:-}" ] && curl -fsS -m 10 "https://api.telegram.org/bot$ALERT_TG_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$ALERT_TG_CHAT" --data-urlencode "text=$1" >/dev/null || true
}
finish() { # $1=ok(true/false) $2=fayl $3=xato
  printf '{"at":"%s","ok":%s,"file":"%s","error":"%s"}\n' "$(date -u +%FT%TZ)" "$1" "$2" "${3//\"/\'}" > "$STATUS"
  chown dasturxon:dasturxon "$STATUS" 2>/dev/null || true
  [ "$1" = true ] || { alert "⚠️ FastHub zaxira nusxa xatosi: $3"; exit 1; }
  exit 0
}

SRC=$(ls -t "$DATA"/backups/db-*.sqlite 2>/dev/null | head -1)
[ -n "$SRC" ] || finish false "" "zaxira fayli topilmadi ($DATA/backups)"
sqlite_ok=$(head -c 16 "$SRC" | grep -c "SQLite format 3" || true)
[ "$sqlite_ok" = 1 ] || finish false "$SRC" "fayl buzilgan: $SRC"

NAME="fasthub-$(date +%F).sqlite.gz"
if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  NAME="$NAME.enc"
  gzip -c "$SRC" | openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE > "$LOCAL/$NAME" || finish false "$NAME" "shifrlash xatosi"
else
  gzip -c "$SRC" > "$LOCAL/$NAME" || finish false "$NAME" "siqish xatosi"
fi
find "$LOCAL" -name 'fasthub-*.sqlite.gz*' -mtime +"$KEEP" -delete

[ -n "${BACKUP_REMOTE:-}" ] || finish false "$NAME" "BACKUP_REMOTE sozlanmagan — nusxa faqat shu serverda ($LOCAL)"
[ -n "${BACKUP_PASSPHRASE:-}" ] || finish false "$NAME" "BACKUP_PASSPHRASE yo'q — shifrlanmagan nusxa tashqariga yuborilmaydi"
command -v rclone >/dev/null || finish false "$NAME" "rclone o'rnatilmagan"
ERR=$(rclone copy "$LOCAL/$NAME" "$BACKUP_REMOTE" --retries 3 2>&1 >/dev/null) || finish false "$NAME" "rclone: ${ERR:0:300}"
rclone delete "$BACKUP_REMOTE" --min-age "${KEEP}d" --include 'fasthub-*' >/dev/null 2>&1 || true
finish true "$NAME" ""
