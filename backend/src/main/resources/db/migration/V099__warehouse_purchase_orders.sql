ALTER TABLE stock_documents ADD COLUMN purchase_order_id uuid REFERENCES stock_documents(id);
CREATE INDEX idx_stock_documents_purchase_order ON stock_documents(purchase_order_id);
