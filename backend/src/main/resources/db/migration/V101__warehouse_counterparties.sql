CREATE TABLE warehouse_counterparties (
    id uuid PRIMARY KEY,
    name varchar(240) NOT NULL,
    contact_name varchar(160),
    phone varchar(64),
    email varchar(254),
    comment text,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_documents
    ADD COLUMN counterparty_id uuid REFERENCES warehouse_counterparties(id);

CREATE INDEX idx_stock_documents_counterparty ON stock_documents(counterparty_id);
