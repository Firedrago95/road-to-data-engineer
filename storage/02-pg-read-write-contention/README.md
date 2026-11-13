# 02. PostgreSQL 대용량 읽기·쓰기 동시 실행 시 락 경합 vs 자원 경합(MVCC) 검증

- 일시: 2026-11-13
- 목표: 같은 테이블을 대상으로 대용량 읽기(`SELECT`)와 대용량 쓰기(`UPDATE`, `INSERT`)가 동시에 실행될 때, 실행 시간 증가의 원인이 락 경합인지 자원 경합인지 로컬 Docker 환경에서 직접 재현해 확인

## 1. 실험 전 예측 (사용자 사전 작성)

### 실험 1 (`UPDATE` 진행 중 `SELECT` 실행)
> "읽기는 S락, 쓰기는 X락(배타적 락). S락 걸리면 다른 읽기는 안 막고 쓰기만 막을 거고 X락은 읽기 쓰기 다 막는 걸로 아는데, 그럼 대용량 읽기 진행 중일 때 대용량 쓰기도 막히겠네. 그렇게 생각하면 락 경합 같기도?"

### 실험 2 (`INSERT` 진행 중 `SELECT` 실행)
> 1. "안 걸릴 듯? 애초에 INSERT 대상은 SELECT 대상이 아니네"
> 2. "아 이건 트랜잭션 격리 수준에 의해 커밋 안 된 데이터가 나오진 않지"

## 2. 실험 환경

- 실행 환경: Docker `postgres:16` (`lab-pg-contention`, 호스트 포트 `5433`)
- 데이터 구성 ([init.sql](./init.sql)): `sales_log` 테이블(`id`, `store_id`, `item_id`, `qty`, `created_at`, `payload`)에 초기 더미 데이터 **2,000,000건** 적재
- 실행 스크립트: [run_experiment.sh](./run_experiment.sh), [run_insert_experiment.sh](./run_insert_experiment.sh)

## 3. 실험 및 실측 결과

### 실험 1: 대용량 `UPDATE` 진행 중 `SELECT` 실행 ([run_experiment.sh](./run_experiment.sh))

사용자가 작성한 읽기/쓰기/관측 쿼리:
```sql
-- 1) 대용량 읽기
SELECT SUM(sl.qty), sl.store_id
FROM sales_log sl
GROUP BY sl.store_id
ORDER BY SUM(sl.qty) DESC;

-- 2) 대용량 쓰기 (약 200만 건 수정)
UPDATE sales_log sl
SET qty = sl.qty + 1
WHERE sl.store_id <= 150;

-- 3) 상태 관측
SELECT pid, state, wait_event_type, wait_event, left(query, 55) AS query
FROM pg_stat_activity
WHERE state = 'active' AND pid != pg_backend_pid();
```

실측 출력:
```text
=== 1. 단독 실행 (Baseline) ===
[단독 SELECT]
(300 rows)
Time: 232.472 ms

[단독 UPDATE]
UPDATE 2000098
Time: 4335.485 ms (00:04.335)

=== 2. 동시 실행 (UPDATE 진행 중 SELECT 진입) ===
[진행 중 pg_stat_activity 상태]
 pid | state  | wait_event_type | wait_event |                          query                          
-----+--------+-----------------+------------+---------------------------------------------------------
 232 | active |                 |            | UPDATE sales_log sl SET qty = sl.qty + 1 WHERE sl.store

[동시 SELECT 결과]
(300 rows)
Time: 817.551 ms

[동시 UPDATE 결과]
UPDATE 2000098
Time: 4874.482 ms (00:04.874)
```
- 실측: `UPDATE`가 4.87초 동안 진행되는 도중에도 `SELECT`는 락 대기로 멈추지 않고 **0.81초(817.551 ms)** 만에 완료됨. 단, 단독 실행(`232.472 ms`) 대비 실행 시간은 약 3.5배 증가함.

### 실험 2: 대용량 `INSERT` 진행 중 `SELECT` 실행 ([run_insert_experiment.sh](./run_insert_experiment.sh))

실측 출력:
```text
=== 1. INSERT 전 전체 합계/건수 ===
  count  |   sum    
---------+----------
 4000000 | 48000294
Time: 173.964 ms

=== 2. 200만 건 INSERT 실행 중 SELECT 진입 ===
[진행 중 pg_stat_activity 상태]
 pid | state  | wait_event_type | wait_event |                          query                          
-----+--------+-----------------+------------+---------------------------------------------------------
 300 | active |                 |            | INSERT INTO sales_log (store_id, item_id, qty, created_

[INSERT 도중 SELECT 결과]
  count  |   sum    
---------+----------
 4000000 | 48000294
Time: 138.455 ms

INSERT 0 2000000
Time: 2264.402 ms (00:02.264)

=== 3. INSERT 커밋 후 전체 합계/건수 ===
  count  |   sum    
---------+----------
 6000000 | 69000294
Time: 185.599 ms
```
- 실측: `INSERT`가 2.26초 동안 도는 중에도 `SELECT`는 락 대기 없이 **138.455 ms** 만에 끝났고, 커밋되지 않은 행은 합계(`4,000,000`건)에 포함되지 않음.

## 4. 결론 및 한계점 (사용자 작성)

### 예상 대 실측의 차이
> "실제로는 락 경합이 있을 것으로 예상했지만, MVCC를 통해 `UPDATE`는 기존의 테이블 옆에 새로운 행을 만들고 `SELECT` 문에는 이전 버전(스냅샷)을 그대로 돌려주어 락 경합 자체가 발생하지 않는다. 하지만 MVCC로 인해 불어난 새로운 데이터 덕분에 `SELECT` 문이 읽어야 할 데이터 양이 2배가 되고, 컴퓨터 자원을 경합하게 되면서 실행 시간은 늘어나는 결과를 볼 수 있었다."

### 남은 질문 및 3줄 정리
1. `UPDATE` 문과 `SELECT` 문은 MVCC로 인해 동시 실행 시 락 경합이 발생하지 않는다. 리소스 경합은 발생한다.
2. `INSERT` 문과 `SELECT` 문은 트랜잭션 격리 수준으로 인해 락 경합이 생기지 않는다.
3. 이 실험으로 확인 못한 것: "그럼 락 경합이 발생하는 경우는 언제지? `UPDATE + UPDATE`도 MVCC 논리에 따르면 행만 더 만들면 되는 거 같은데"
   - (보충 확인: 같은 행을 동시에 `UPDATE`할 때는 데이터 유실(Lost Update)을 막기 위해 선행 트랜잭션이 행 단위 락을 잡고 후행 트랜잭션은 커밋/롤백 전까지 대기함. `TRUNCATE`/`ALTER` 등 DDL과 겹치는 경우도 본 실험 범위 밖으로 남겨둠.)
