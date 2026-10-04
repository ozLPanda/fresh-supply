CREATE TABLE order_assistant_sessions (
    id uuid PRIMARY KEY,
    owner_id bigint NOT NULL REFERENCES users(id),
    mode varchar(20) NOT NULL CHECK (mode IN ('CREATE', 'DRAFT')),
    price_tier varchar(32) NOT NULL,
    order_date date NOT NULL,
    revision bigint NOT NULL DEFAULT 0,
    applied_revision bigint NOT NULL DEFAULT -1,
    order_id uuid REFERENCES orders(id),
    order_snapshot text,
    messages_json text NOT NULL DEFAULT '[]',
    pending_removals_json text NOT NULL DEFAULT '[]',
    proposal_json text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX order_assistant_sessions_owner_idx ON order_assistant_sessions(owner_id, updated_at DESC);
CREATE UNIQUE INDEX order_assistant_sessions_order_idx ON order_assistant_sessions(order_id) WHERE order_id IS NOT NULL;
CREATE TABLE order_assistant_memories (
    id uuid PRIMARY KEY,
    owner_id bigint NOT NULL REFERENCES users(id),
    kind varchar(20) NOT NULL,
    source varchar(240) NOT NULL,
    target_id varchar(80) NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(owner_id, kind, source)
);
