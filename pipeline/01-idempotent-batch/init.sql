-- 1. 원천 데이터: 주문 테이블 (OLTP 환경 모사)
DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
    order_id INT PRIMARY KEY,
    ordered_at TIMESTAMP NOT NULL,
    customer_id VARCHAR(50) NOT NULL,
    amount NUMERIC NOT NULL,
    status VARCHAR(20) NOT NULL
);

-- 2. 타깃 테이블: 일별 매출 집계 테이블 (OLAP / 데이터 마트 모사)
DROP TABLE IF EXISTS daily_revenue;
CREATE TABLE daily_revenue (
    target_date DATE PRIMARY KEY,
    total_orders INT NOT NULL,
    total_amount NUMERIC NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. 초기 원천 데이터 적재
-- 2026-11-03 데이터 (총 5건, 합계: 150,000원)
INSERT INTO orders VALUES
(1, '2026-11-03 10:00:00', 'C1', 30000, 'COMPLETED'),
(2, '2026-11-03 12:30:00', 'C2', 50000, 'COMPLETED'),
(3, '2026-11-03 15:45:00', 'C3', 20000, 'COMPLETED'),
(4, '2026-11-03 18:20:00', 'C1', 40000, 'COMPLETED'),
(5, '2026-11-03 23:10:00', 'C4', 10000, 'COMPLETED');

-- 2026-11-04 데이터 (재실행 시점인 다음날 데이터: 총 2건, 합계: 60,000원)
INSERT INTO orders VALUES
(6, '2026-11-04 09:15:00', 'C2', 25000, 'COMPLETED'),
(7, '2026-11-04 14:00:00', 'C5', 35000, 'COMPLETED');
