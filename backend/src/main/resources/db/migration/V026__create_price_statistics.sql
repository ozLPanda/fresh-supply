create table product_price_statistics_imports (
    id bigserial primary key,
    import_session_id uuid not null unique references product_price_import_sessions(id) on delete cascade,
    file_name varchar(260) not null,
    created_by_name varchar(160) not null,
    completed_at timestamptz not null,
    changed_products integer not null default 0,
    changed_price_points integer not null default 0,
    average_change_percent numeric(14, 6) not null default 0
);

create table product_price_change_snapshots (
    id bigserial primary key,
    statistics_import_id bigint not null references product_price_statistics_imports(id) on delete cascade,
    product_id bigint references products(id) on delete set null,
    sku varchar(255) not null,
    product_name varchar(500) not null,
    category_id bigint references categories(id) on delete set null,
    category_name varchar(255),
    price_type varchar(40) not null,
    old_price numeric(14, 2) not null,
    new_price numeric(14, 2) not null,
    change_percent numeric(14, 6) not null
);

create index product_price_statistics_imports_completed_at_idx
    on product_price_statistics_imports(completed_at desc);

create index product_price_change_snapshots_import_idx
    on product_price_change_snapshots(statistics_import_id);

create index product_price_change_snapshots_category_idx
    on product_price_change_snapshots(statistics_import_id, category_id);

create index product_price_change_snapshots_product_idx
    on product_price_change_snapshots(statistics_import_id, product_id);
