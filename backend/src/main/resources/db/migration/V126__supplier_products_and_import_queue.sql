create table supplier_products (
    id bigserial primary key,
    supplier_code varchar(50) not null,
    external_id varchar(100) not null,
    sku text,
    name text not null,
    description text,
    image_url text,
    purchase_price numeric(38,8),
    retail_price numeric(38,8),
    brand text,
    availability text,
    details jsonb not null,
    synced_at timestamptz not null default now(),
    next_sync_at timestamptz not null default now() + interval '24 hours',
    unique (supplier_code, external_id)
);
create index supplier_products_sync_due on supplier_products(next_sync_at, id);
create index supplier_products_supplier on supplier_products(supplier_code, id);

create table supplier_import_jobs (
    id bigserial primary key,
    supplier_code varchar(50) not null,
    scope varchar(20) not null check (scope in ('SELECTED', 'FILTERED', 'ALL')),
    status varchar(20) not null check (status in ('QUEUED', 'DISCOVERING', 'RUNNING', 'COMPLETED', 'FAILED')),
    selection jsonb not null,
    discovery_page integer not null default 1,
    discovery_category integer not null default 0,
    discovery_fingerprint varchar(64),
    discovery_done boolean not null default false,
    discovery_attempts integer not null default 0,
    next_discovery_at timestamptz not null default now(),
    discovered bigint not null default 0,
    processed bigint not null default 0,
    failed bigint not null default 0,
    pending bigint not null default 0,
    error text,
    automatic boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index supplier_import_jobs_active on supplier_import_jobs(id)
    where status in ('QUEUED', 'DISCOVERING', 'RUNNING');

create table supplier_import_items (
    id bigserial primary key,
    job_id bigint not null references supplier_import_jobs(id) on delete cascade,
    external_id varchar(100) not null,
    status varchar(20) not null default 'PENDING' check (status in ('PENDING', 'COMPLETED', 'FAILED')),
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    error text,
    unique (job_id, external_id)
);
create index supplier_import_items_pending on supplier_import_items(job_id, next_attempt_at, id)
    where status = 'PENDING';

insert into permissions(code, entity_name, action_name, name_ru) values
    ('pages.supplier-products.view', 'pages.supplier-products', 'view', 'Просмотр товаров поставщиков'),
    ('supplier-products.import', 'supplier-products', 'import', 'Импорт товаров поставщиков')
on conflict (code) do nothing;
insert into role_permissions(role_id, permission_id)
select r.id, p.id from roles r
join permissions p on p.code in ('pages.supplier-products.view', 'supplier-products.import')
where r.code = 'administrator'
on conflict do nothing;
