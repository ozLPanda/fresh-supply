CREATE SEQUENCE product_sku_seq;

-- Continue after existing numeric articles, including soft-deleted products.
-- Limit the cast to values that safely fit into the sequence's bigint range.
SELECT setval(
    'product_sku_seq',
    COALESCE(MAX(CASE WHEN sku ~ '^[0-9]{1,18}$' THEN sku::bigint END), 0) + 1,
    false
)
FROM products;
