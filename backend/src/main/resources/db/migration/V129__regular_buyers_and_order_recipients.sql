CREATE TABLE regular_buyers (
    id UUID PRIMARY KEY,
    name VARCHAR(240) NOT NULL,
    contact_name VARCHAR(160),
    phone VARCHAR(64),
    email VARCHAR(254),
    comment TEXT,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX regular_buyers_name_idx ON regular_buyers (lower(name));

-- Legacy orders have no separately selected recipient; never derive it from customer accounts.
ALTER TABLE orders ADD COLUMN regular_buyer_id UUID REFERENCES regular_buyers(id);
ALTER TABLE orders ADD COLUMN regular_buyer_name VARCHAR(240);
CREATE INDEX orders_regular_buyer_idx ON orders (regular_buyer_id);

INSERT INTO permissions(code, entity_name, action_name, name_ru) VALUES
('pages.regular-buyers.view', 'pages.regular-buyers', 'view', 'Страница постоянных покупателей'),
('regular-buyers.read', 'regular-buyers', 'read', 'Просмотр постоянных покупателей'),
('regular-buyers.manage', 'regular-buyers', 'manage', 'Управление постоянными покупателями')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
('pages.regular-buyers.view', 'regular-buyers.read', 'regular-buyers.manage')
WHERE r.code = 'administrator'
ON CONFLICT DO NOTHING;
