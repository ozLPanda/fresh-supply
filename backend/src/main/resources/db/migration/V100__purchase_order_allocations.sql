CREATE TABLE purchase_order_allocations (
    document_id uuid NOT NULL REFERENCES stock_documents(id),
    position integer NOT NULL,
    source_document_id uuid NOT NULL REFERENCES stock_documents(id),
    product_id bigint NOT NULL REFERENCES products(id),
    quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (document_id, position),
    UNIQUE (document_id, source_document_id, product_id),
    CHECK (document_id <> source_document_id)
);
CREATE INDEX idx_purchase_allocations_source ON purchase_order_allocations(source_document_id);

-- Recover links produced by the original single-order carry-forward action.
INSERT INTO purchase_order_allocations (document_id, position, source_document_id, product_id, quantity)
SELECT target.id, (row_number() OVER (PARTITION BY target.id ORDER BY line.id) - 1)::integer,
       source.id, line.product_id, line.quantity
FROM stock_documents target
JOIN stock_documents source ON target.reference = 'Неполученные товары по заказу ' || source.document_number
JOIN stock_document_lines line ON line.document_id = target.id
WHERE target.document_type = 'PURCHASE_ORDER' AND source.document_type = 'PURCHASE_ORDER'
  AND source.id <> target.id AND line.quantity > 0
  AND EXISTS (SELECT 1 FROM stock_document_lines original
              WHERE original.document_id = source.id AND original.product_id = line.product_id);
