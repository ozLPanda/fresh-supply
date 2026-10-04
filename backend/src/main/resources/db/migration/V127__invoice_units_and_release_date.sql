-- Preserve the old catalogue/invoice meaning for existing records.
ALTER TABLE products ADD COLUMN measurement_unit VARCHAR(16) NOT NULL DEFAULT 'PIECE';
ALTER TABLE products ALTER COLUMN measurement_unit SET DEFAULT 'KG';
ALTER TABLE products ADD CONSTRAINT products_measurement_unit_check CHECK (measurement_unit IN ('KG', 'PIECE'));

ALTER TABLE order_items ADD COLUMN measurement_unit VARCHAR(16) NOT NULL DEFAULT 'PIECE';
ALTER TABLE order_items ADD CONSTRAINT order_items_measurement_unit_check CHECK (measurement_unit IN ('KG', 'PIECE'));

-- Existing release times are unknown. The invoice renderer uses created_at for these rows.
ALTER TABLE orders ADD COLUMN invoice_issued_at TIMESTAMPTZ;
