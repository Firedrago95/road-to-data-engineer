CREATE TABLE IF NOT EXISTS sales_log (
    id BIGSERIAL PRIMARY KEY,
    store_id INT NOT NULL,
    item_id INT NOT NULL,
    qty INT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    payload TEXT NOT NULL
);

INSERT INTO sales_log (store_id, item_id, qty, created_at, payload)
SELECT
    (g % 300) + 1,
    (g % 5000) + 1,
    (g % 20) + 1,
    NOW() - (g || ' seconds')::INTERVAL,
    repeat('x', 100)
FROM generate_series(1, 2000000) AS g;
