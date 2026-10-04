create table warehouses (
    id bigserial primary key,
    code varchar(40) not null unique,
    name_ru varchar(160) not null,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

insert into warehouses(code, name_ru) values ('MAIN', 'Основной склад');

create table stock_documents (
    id uuid primary key,
    document_number varchar(40) unique,
    document_type varchar(40) not null,
    status varchar(24) not null default 'DRAFT',
    warehouse_id bigint not null references warehouses(id),
    source_order_id uuid references orders(id),
    reference varchar(160),
    comment text,
    created_by_user_id bigint references users(id),
    posted_by_user_id bigint references users(id),
    cancelled_by_user_id bigint references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    posted_at timestamptz,
    cancelled_at timestamptz
);
create sequence stock_document_number_seq start with 1 increment by 1;
create index stock_documents_warehouse_created_idx on stock_documents(warehouse_id, created_at desc);
create index stock_documents_source_order_idx on stock_documents(source_order_id);

create table stock_document_lines (
    id bigserial primary key,
    document_id uuid not null references stock_documents(id) on delete cascade,
    product_id bigint not null references products(id),
    quantity numeric(14, 3) not null check (quantity >= 0),
    unit_cost numeric(14, 2),
    comment varchar(500)
);
create index stock_document_lines_document_idx on stock_document_lines(document_id);
create index stock_document_lines_product_idx on stock_document_lines(product_id);

create table stock_movements (
    id uuid primary key,
    warehouse_id bigint not null references warehouses(id),
    document_id uuid not null references stock_documents(id),
    product_id bigint not null references products(id),
    quantity numeric(14, 3) not null check (quantity <> 0),
    unit_cost numeric(14, 2),
    movement_type varchar(40) not null,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);
create index stock_movements_balance_idx on stock_movements(warehouse_id, product_id, occurred_at);
create index stock_movements_document_idx on stock_movements(document_id);

create table stock_cost_layers (
    id uuid primary key,
    warehouse_id bigint not null references warehouses(id),
    product_id bigint not null references products(id),
    source_document_id uuid not null references stock_documents(id),
    original_quantity numeric(14, 3) not null check (original_quantity > 0),
    remaining_quantity numeric(14, 3) not null check (remaining_quantity >= 0),
    unit_cost numeric(14, 2),
    received_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);
create index stock_cost_layers_fifo_idx on stock_cost_layers(warehouse_id, product_id, received_at, created_at)
    where remaining_quantity > 0;

create table stock_reservations (
    id uuid primary key,
    warehouse_id bigint not null references warehouses(id),
    order_id uuid not null references orders(id) on delete cascade,
    product_id bigint not null references products(id),
    quantity numeric(14, 3) not null check (quantity > 0),
    status varchar(24) not null default 'ACTIVE',
    created_at timestamptz not null default now(),
    released_at timestamptz
);
create unique index stock_reservations_active_order_product_idx
    on stock_reservations(warehouse_id, order_id, product_id) where status = 'ACTIVE';
create index stock_reservations_balance_idx on stock_reservations(warehouse_id, product_id) where status = 'ACTIVE';

insert into permissions(code, entity_name, action_name, name_ru) values
('warehouse.read', 'warehouse', 'read', 'Просмотр склада'),
('warehouse.manage', 'warehouse', 'manage', 'Управление складом'),
('warehouse.costs.read', 'warehouse', 'costs.read', 'Просмотр себестоимости')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id from roles r join permissions p on p.code in ('warehouse.read', 'warehouse.manage', 'warehouse.costs.read')
where r.code = 'administrator'
on conflict do nothing;
