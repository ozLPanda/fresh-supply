create table price_setting_groups (
    id uuid primary key,
    name varchar(160) not null,
    common_rules text,
    comment text,
    created_by_user_id bigint references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index price_setting_groups_updated_idx on price_setting_groups(updated_at desc);

alter table stock_documents
    add column price_setting_group_id uuid references price_setting_groups(id),
    add column price_source_type varchar(32),
    add column price_source_price_type varchar(32),
    add column price_source_document_id uuid references stock_documents(id),
    add column price_operation varchar(32),
    add column price_operation_value numeric(14, 2);

create index stock_documents_price_group_idx
    on stock_documents(price_setting_group_id, created_at desc)
    where price_setting_group_id is not null;

alter table stock_document_lines
    add column source_price numeric(14, 2),
    add column source_description varchar(500),
    add column price_operation varchar(32),
    add column price_operation_value numeric(14, 2),
    add column manual_price boolean not null default false;
