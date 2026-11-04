# 01. 멱등한 데이터 파이프라인 설계

- **일시**: 2026-11-04
- **목표**: 배치 재실행 시 데이터 정합성을 보장하는 멱등성(Idempotency) 구현 원리 검증

---

## 1. 실험 환경
- **DBMS**: PostgreSQL 16 (`lab-idempotent-db`, 포트 5433)
- **원천 테이블 (`orders`)**:
  - `2026-11-03`: 5건 (초기 합계 150,000원 -> 정정 후 190,000원)
  - `2026-11-04`: 2건 (합계 60,000원)
- **타깃 테이블 (`daily_revenue`)**: `target_date (PK)`, `total_orders`, `total_amount`

---

## 2. 실험 및 실측 결과

### 실험 1: `NOW()` 기반 범위 조회 (지연/재실행 모사)
11-03 자정 배치가 실패하여 11-04 저녁에 재실행된 상황.

```sql
SELECT COUNT(*), SUM(amount)
FROM orders
WHERE ordered_at >= NOW() - INTERVAL '1 day';
```
```text
 count |  sum   
-------+--------
     6 | 180000
(1 row)
```
- **원인**: 실행 시점의 시스템 시간을 참조하여 11-03 오전 주문(1번) 누락 및 11-04 당일 주문(6, 7번) 혼입.
- **해결**: 반열린 구간(`[start, end)`)과 고정 파라미터(`{{ data_interval_start }}`) 사용.

```sql
SELECT COUNT(*), SUM(amount)
FROM orders
WHERE ordered_at >= '2026-11-03' AND ordered_at < '2026-11-04';
```
```text
 count |  sum   
-------+--------
     5 | 150000
(1 row)
```

---

### 실험 2: `ON CONFLICT DO NOTHING` (원천 정정 데이터 재실행)
원천 테이블 5번 주문 금액 정정(10,000원 -> 50,000원) 후 11-03 재집계 적재.

```sql
INSERT INTO daily_revenue (target_date, total_orders, total_amount)
VALUES ('2026-11-03', 5, 190000)
ON CONFLICT (target_date) DO NOTHING;

SELECT target_date, total_orders, total_amount FROM daily_revenue;
```
```text
INSERT 0 0
 target_date | total_orders | total_amount 
-------------+--------------+--------------
 2026-11-03  |            5 |       150000
(1 row)
```
- **원인**: 에러 없이 정상 종료되나 PK 중복으로 스킵되어 정정 내역(190,000원)이 미반영됨.

---

### 실험 3: 단일 트랜잭션 기반 `DELETE + INSERT`

```sql
BEGIN;

DELETE FROM daily_revenue 
WHERE target_date = '2026-11-03';

INSERT INTO daily_revenue (target_date, total_orders, total_amount)
SELECT 
    '2026-11-03',
    COUNT(*),
    SUM(amount)
FROM orders
WHERE ordered_at >= '2026-11-03' AND ordered_at < '2026-11-04';

COMMIT;

SELECT target_date, total_orders, total_amount FROM daily_revenue;
```
```text
BEGIN
DELETE 1
INSERT 0 1
COMMIT

 target_date | total_orders | total_amount 
-------------+--------------+--------------
 2026-11-03  |            5 |       190000
(1 row)
```
- **결과**: 정정된 190,000원으로 갱신됨. 동일 쿼리를 연속 5회 재실행해도 1행 190,000원 상태 유지 확인.

---

## 3. 핵심 정리
1. **`NOW()` 사용 배제**: 실행 시점 의존성을 제거하고 불변 파라미터(`data_interval_start`, `data_interval_end`)를 사용할 것.
2. **`UPDATE` 대신 `Delete-Insert` 사용 이유**: 
   - 원천에서 행이 삭제/취소된 경우 `UPDATE`로는 미삭제 잔존 데이터(Ghost row)를 처리할 수 없음.
   - 대규모 분산 스토리지(Parquet, S3 등)는 행 단위 `UPDATE`를 지원하지 않고 파티션 덮어쓰기(Overwrite)를 사용함.
3. **단일 트랜잭션 보장**: 중간 실패 시 데이터 유실을 방지하기 위해 `BEGIN ~ COMMIT` 원자성 유지 필수.

---

## 4. 확인하지 못한 것
- 실제 Airflow 스케줄러 런타임에서의 매크로 변수 주입 동작.
- 수천만 건 테이블에서 `DELETE` 시 발생하는 테이블/행 락(Lock) 및 WAL 증가 부하.
- Citus 분산 샤딩 환경에서의 트랜잭션 롤백(2PC) 동작.
