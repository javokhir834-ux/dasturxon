#!/bin/bash
# Barcha API testlari: har biri toza bazada
APP="$(cd "$(dirname "$0")/.." && pwd)/src/server.ts"; cd "$(dirname "$0")/.."
start() { rm -rf /tmp/t$1; DATA_DIR=/tmp/t$1 PORT=8080 PLATFORM_PASSWORD=platforma-test-1 TG_API=http://localhost:8099 node $APP >/tmp/srv_$1.log 2>&1 & echo $! > /tmp/srv.pid; node -e "require('./tests/_ready.cjs')(8080)"; }
stop() { kill $(cat /tmp/srv.pid) 2>/dev/null; sleep 0.4; }
pkill -f "src/server.ts"; sleep 0.3
for t in flow office staff tenant; do start $t; echo "== $t"; DATA_DIR=/tmp/t$t node tests/$t.cjs 2>&1 | tail -1; stop; done
for t in sync delivery delivery_sync courier platform push retail launch onboarding; do echo "== $t"; node tests/$t.cjs 2>&1 | tail -1; pkill -f "src/server.ts"; sleep 0.3; done
