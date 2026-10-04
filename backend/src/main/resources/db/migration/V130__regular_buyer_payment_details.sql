ALTER TABLE regular_buyers ADD COLUMN tax_id VARCHAR(12);
ALTER TABLE regular_buyers ADD COLUMN legal_address VARCHAR(1000);

ALTER TABLE regular_buyers ADD CONSTRAINT regular_buyers_tax_id_format
    CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{12}$');
