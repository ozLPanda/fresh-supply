create table ai_price_sessions (
    id uuid primary key,
    receipt_id uuid not null references stock_documents(id),
    group_id uuid not null,
    group_name varchar(160) not null,
    group_rules_snapshot text,
    group_comment_snapshot text,
    status varchar(20) not null check (status in ('QUESTIONS', 'PREVIEW', 'CONFIRMED')),
    assistant_message text,
    questions_json text not null default '[]',
    messages_json text not null default '[]',
    rows_json text not null default '[]',
    created_document_ids_json text not null default '[]',
    created_by_user_id bigint not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index ai_price_sessions_receipt_idx on ai_price_sessions (receipt_id, created_at desc);
