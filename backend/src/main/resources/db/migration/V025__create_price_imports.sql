create table product_price_import_sessions (
    id uuid primary key,
    file_name varchar(260) not null,
    status varchar(40) not null,
    total_rows integer not null default 0,
    changed_rows integer not null default 0,
    unchanged_rows integer not null default 0,
    not_found_rows integer not null default 0,
    invalid_rows integer not null default 0,
    duplicate_rows integer not null default 0,
    analysis_json text not null,
    preview_json text not null,
    created_by_user_id bigint references users(id) on delete set null,
    created_by_name varchar(160) not null,
    committed_updated integer,
    committed_unchanged integer,
    committed_skipped integer,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz
);

create index product_price_import_sessions_created_at_idx
    on product_price_import_sessions(created_at desc);

create index product_price_import_sessions_status_idx
    on product_price_import_sessions(status);
