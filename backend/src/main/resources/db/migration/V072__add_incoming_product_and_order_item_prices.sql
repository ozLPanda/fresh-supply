ALTER TABLE products ADD COLUMN incoming_price NUMERIC(14, 2);

-- A cost snapshot makes historical net-profit reports independent of subsequent supplier-price imports.
ALTER TABLE order_items ADD COLUMN incoming_price NUMERIC(14, 2);
