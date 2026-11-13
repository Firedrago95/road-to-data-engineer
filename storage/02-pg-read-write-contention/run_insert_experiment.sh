#!/usr/bin/env bash
set -e

CONTAINER="lab-pg-contention"
PSQL="docker exec -i $CONTAINER psql -U lab -d labdb -v ON_ERROR_STOP=1"

echo "=== 1. INSERT 전 전체 합계/건수 ==="
$PSQL -c "\timing on" -c "SELECT COUNT(*), SUM(qty) FROM sales_log;"

echo ""
echo "=== 2. 200만 건 INSERT 실행 중 SELECT 진입 ==="
(
  echo "[INSERT 완료]"
  $PSQL -c "\timing on" -c "INSERT INTO sales_log (store_id, item_id, qty, created_at, payload) SELECT (g % 300) + 1, (g % 5000) + 1, (g % 20) + 1, NOW() - (g || ' seconds')::INTERVAL, repeat('x', 100) FROM generate_series(1, 2000000) AS g;"
) &
INS_PID=$!

sleep 0.5

echo "[진행 중 pg_stat_activity 상태]"
$PSQL -c "SELECT pid, state, wait_event_type, wait_event, left(query, 55) AS query FROM pg_stat_activity WHERE state = 'active' AND pid != pg_backend_pid();"

echo "[INSERT 도중 SELECT 결과]"
$PSQL -c "\timing on" -c "SELECT COUNT(*), SUM(qty) FROM sales_log;"

wait $INS_PID

echo ""
echo "=== 3. INSERT 커밋 후 전체 합계/건수 ==="
$PSQL -c "\timing on" -c "SELECT COUNT(*), SUM(qty) FROM sales_log;"
