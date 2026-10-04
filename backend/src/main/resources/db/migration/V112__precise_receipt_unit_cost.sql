ALTER TABLE stock_document_lines ALTER COLUMN unit_cost TYPE numeric(18, 6);
ALTER TABLE stock_movements ALTER COLUMN unit_cost TYPE numeric(18, 6);
ALTER TABLE stock_cost_layers ALTER COLUMN unit_cost TYPE numeric(18, 6);
