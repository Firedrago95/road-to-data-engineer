#!/usr/bin/env bash
set -e

CONTAINER="lab-pg-contention"
PSQL="docker exec -i $CONTAINER psql -U lab -d labdb -v ON_ERROR_STOP=1"

echo "=== 1. 단독 실행 (Baseline) ==="
echo "[단독 SELECT]"
$PSQL -c "\timing on" -c "SELECT SUM(sl.qty), sl.store_id FROM sales_log sl GROUP BY sl.store_id ORDER BY SUM(sl.qty) DESC;" | tail -n 3

echo "[단독 UPDATE]"
$PSQL -c "\timing on" -c "UPDATE sales_log sl SET qty = sl.qty + 1 WHERE sl.store_id <= 150;"

echo ""
echo "=== 2. 동시 실행 (UPDATE 진행 중 SELECT 진입) ==="
(
  echo "[동시 UPDATE 결과]"
  $PSQL -c "\timing on" -c "UPDATE sales_log sl SET qty = sl.qty + 1 WHERE sl.store_id <= 150;"
) &
UPD_PID=$!

sleep 0.5

echo "[진행 중 pg_stat_activity 상태 (1차)]"
$PSQL -c "SELECT pid, state, wait_event_type, wait_event, left(query, 55) AS query FROM pg_stat_activity WHERE state = 'active' AND pid != pg_backend_pid();"

echo "[동시 SELECT 결과]"
$PSQL -c "\timing on" -c "SELECT SUM(sl.qty), sl.store_id FROM sales_log sl GROUP BY sl.store_id ORDER BY SUM(sl.qty) DESC;" | tail -n 3

echo "[진행 중 pg_stat_activity 상태 (2차)]"
$PSQL -c "SELECT pid, state, wait_event_type, wait_event, left(query, 55) AS query FROM pg_stat_activity WHERE state = 'active' AND pid != pg_backend_pid();"

wait $UPD_PID
