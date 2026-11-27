#!/usr/bin/env bash
# Server holatini tekshirish (cron: har 2 daqiqada, root). /api/health 2 marta ketma-ket javob bermasa — xizmat qayta ishga tushiriladi
# va Telegramga xabar ketadi (ALERT_TG_TOKEN, ALERT_TG_CHAT). Tiklanganda ham xabar keladi. Disk 90% dan to'lsa — kuniga 1 marta ogohlantirish.
# Tashqi kuzatuv uchun qo'shimcha: UptimeRobot (bepul) → https://DOMEN/api/health — server butunlay o'chsa ham xabar beradi.
set -uo pipefail
APP=/opt/dasturxon
set -a; [ -f "$APP/.env" ] && . "$APP/.env"; set +a
STATE=/var/lib/dasturxon-health
mkdir -p "$STATE"
alert() {
  [ -n "${ALERT_TG_TOKEN:-}" ] && [ -n "${ALERT_TG_CHAT:-}" ] && curl -fsS -m 10 "https://api.telegram.org/bot$ALERT_TG_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$ALERT_TG_CHAT" --data-urlencode "text=$1" >/dev/null || true
}

FAILS=$(cat "$STATE/fails" 2>/dev/null || echo 0)
if curl -fsS -m 10 "http://127.0.0.1:${PORT:-8080}/api/health" | grep -q '"ok":true'; then
  [ "$FAILS" -ge 2 ] && alert "✅ FastHub server yana ishlayapti ($(hostname))"
  echo 0 > "$STATE/fails"
else
  FAILS=$((FAILS + 1)); echo "$FAILS" > "$STATE/fails"
  if [ "$FAILS" -eq 2 ]; then
    systemctl restart dasturxon
    alert "🛑 FastHub server javob bermadi — qayta ishga tushirildi ($(hostname)). Loglar: journalctl -u dasturxon -n 100"
  fi
fi

USE=$(df --output=pcent /var/lib/dasturxon | tail -1 | tr -dc '0-9')
if [ "${USE:-0}" -ge 90 ] && [ "$(cat "$STATE/disk_day" 2>/dev/null)" != "$(date +%F)" ]; then
  date +%F > "$STATE/disk_day"
  alert "💾 FastHub serverida disk ${USE}% to'lgan ($(hostname))"
fi
