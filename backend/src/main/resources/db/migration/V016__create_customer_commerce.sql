create table auth_sessions (
    id bigserial primary key,
    user_id bigint not null references users(id),
    token_hash varchar(64) not null unique,
    expires_at timestamptz not null,
    revoked_at timestamptz,
    created_at timestamptz not null default now()
);
create index auth_sessions_user_id_idx on auth_sessions(user_id);

create table wallets (
    id bigserial primary key,
    user_id bigint not null unique references users(id),
    balance numeric(14,2) not null default 0 check (balance >= 0),
    updated_at timestamptz not null default now()
);

create table orders (
    id bigserial primary key,
    user_id bigint not null references users(id),
    status varchar(30) not null,
    payment_status varchar(30) not null,
    fulfillment_type varchar(30) not null,
    address varchar(500),
    contact_phone varchar(40) not null,
    comment text,
    total numeric(14,2) not null check (total >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index orders_user_id_idx on orders(user_id);

create table order_items (
    id bigserial primary key,
    order_id bigint not null references orders(id) on delete cascade,
    product_id bigint references products(id),
    sku varchar(120) not null,
    name_ru varchar(260) not null,
    unit_price numeric(14,2) not null check (unit_price > 0),
    quantity integer not null check (quantity between 1 and 999),
    line_total numeric(14,2) not null check (line_total > 0)
);

create table wallet_transactions (
    id bigserial primary key,
    wallet_id bigint not null references wallets(id),
    type varchar(30) not null,
    amount numeric(14,2) not null check (amount > 0),
    balance_after numeric(14,2) not null check (balance_after >= 0),
    order_id bigint references orders(id),
    actor_user_id bigint references users(id),
    comment varchar(500) not null,
    created_at timestamptz not null default now()
);
create unique index wallet_transactions_order_refund_uidx
    on wallet_transactions(order_id, type) where type = 'REFUND';
create index wallet_transactions_wallet_id_idx on wallet_transactions(wallet_id);

create table cart_items (
    id bigserial primary key,
    user_id bigint not null references users(id) on delete cascade,
    product_id bigint not null references products(id),
    quantity integer not null check (quantity between 1 and 999),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique(user_id, product_id)
);

insert into wallets(user_id)
select id from users
on conflict (user_id) do nothing;

insert into permissions(code, entity_name, action_name, name_ru) values
('balances.manage', 'balances', 'manage', 'Управление балансами клиентов'),
('orders.read', 'orders', 'read', 'Просмотр заказов'),
('orders.update', 'orders', 'update', 'Изменение статусов заказов'),
('pages.orders.view', 'pages.orders', 'view', 'Страница заказов')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.code = 'administrator'
  and p.code in ('balances.manage', 'orders.read', 'orders.update', 'pages.orders.view')
on conflict do nothing;
