# 01. 멱등한 데이터 파이프라인 설계

- **일시**: 2026-11-04
- **목표**: 배치 재실행 시 데이터 정합성을 보장하는 멱등성 구현 원리 검증

## 1. 실험 전 예측
코드를 작성하고 실행하기 전 세운 가설과 예측입니다.

1. `NOW()`를 사용하면 재실행 시점의 시간이 호출되어 그 직후 데이터까지 섞여 들어가 데이터가 오염될 것이다.
2. `DO NOTHING`(건너뛰기)을 사용하면 기존 행의 수정 여부를 확인하지 않고 무시하므로, 원천 정정 내역이 반영되지 않고 누락될 것이다.
3. 지우고 넣기를 단일 트랜잭션으로 묶으면 도중에 실패해도 전체 롤백되어 데이터가 비는 상황을 막을 수 있고, `data_interval_start`는 언제 실행하든 고정된 대상 기간을 보장해줄 것이다.

## 2. 실험 환경
- **DBMS**: PostgreSQL 16 (`lab-idempotent-db`, 포트 5433)
- **원천 테이블 (`orders`)**:
  - `2026-11-03`: 5건 (초기 합계 150,000원 -> 정정 후 190,000원)
  - `2026-11-04`: 2건 (합계 60,000원)
- **타깃 테이블 (`daily_revenue`)**: `target_date (PK)`, `total_orders`, `total_amount`

## 3. 실험 및 실측 결과

### 실험 1: `NOW()` 기반 범위 조회 (재실행 상황 재현)
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
- **원인**: 실행 시점의 시스템 시간을 참조하여 11-03 오전 10시 주문(1번)이 누락되고, 11-04 당일 주문(6, 7번)이 섞여 들어감.
- **해결**: 반열린 구간(`[start, end)`)과 고정 파라미터(`data_interval_start`) 사용.

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
- **결과**: 정정된 190,000원으로 정상 갱신. 동일 쿼리를 연속 5회 재실행해도 1행 190,000원 상태 유지 확인.

## 4. 결론 및 배운 점
1. **재실행 고려 필수**: DAG를 짤 때는 재실행을 염두에 두어야 하며 언제 실행해도 동일한 결과를 보장해야 한다.
2. **`NOW()` 사용 배제**: 실행 시점의 시간을 직접 사용하는 위험을 피하고, 시간 흐름에 영향받지 않도록 `data_interval_start` 등의 불변 파라미터를 사용한다.
3. **단일 트랜잭션 내 지우고-넣기**: 실패 시 전체 롤백되어 데이터가 비는 현상을 막고 어떤 경우에도 멱등성을 보장한다.
4. **`UPDATE` 대신 `Delete-Insert`를 쓰는 이유**:
   - 원천에서 주문 취소 등으로 행 자체가 사라져야 하는 경우 `UPDATE`는 이를 반영하지 못해 이전 데이터가 남는다.
   - 빅데이터 분산 스토리지(Parquet, S3 등) 환경에서는 개별 행의 `UPDATE`를 지원하지 않거나 비효율적이므로 파티션 단위 덮어쓰기를 사용한다.

## 5. 이 실험으로 확인하지 못한 것
- 실제 Airflow 스케줄러 런타임 환경에서 템플릿 변수가 전달되는 과정.
- 수천만 건 이상의 대용량 테이블에서 `DELETE` 시 발생하는 락(Lock) 및 WAL 증가 부하.
- Citus 분산 샤딩 환경에서의 트랜잭션 롤백(2PC) 동작.
