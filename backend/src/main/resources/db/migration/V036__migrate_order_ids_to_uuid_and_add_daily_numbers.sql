-- Order identifiers are UUIDs.  Existing bigint identifiers are converted to
-- deterministic UUID-shaped values so every dependent record can be migrated
-- within this transaction without relying on a database extension.
alter table orders
    add column id_uuid uuid,
    add column order_number_date date,
    add column daily_number integer;

with historical_orders as (
    select
        id as legacy_id,
        (created_at at time zone 'Asia/Almaty')::date as historical_number_date,
        row_number() over (
            partition by (created_at at time zone 'Asia/Almaty')::date
            order by created_at, id
        )::integer as historical_daily_number,
        (
            substr(md5('company-shop/orders/' || id::text), 1, 8) || '-' ||
            substr(md5('company-shop/orders/' || id::text), 9, 4) || '-' ||
            '4' || substr(md5('company-shop/orders/' || id::text), 14, 3) || '-' ||
            '8' || substr(md5('company-shop/orders/' || id::text), 18, 3) || '-' ||
            substr(md5('company-shop/orders/' || id::text), 21, 12)
        )::uuid as historical_uuid
    from orders
)
update orders o
set id_uuid = historical_orders.historical_uuid,
    order_number_date = historical_orders.historical_number_date,
    daily_number = historical_orders.historical_daily_number
from historical_orders
where o.id = historical_orders.legacy_id;

alter table orders
    alter column id_uuid set not null,
    alter column order_number_date set not null,
    alter column daily_number set not null,
    add constraint orders_daily_number_positive check (daily_number > 0),
    add constraint orders_order_number_date_daily_number_key unique (order_number_date, daily_number);

-- The application increments this row atomically when creating an order.  The
-- historical maxima ensure that a new number never collides with migrated data.
create table order_daily_counters (
    order_number_date date primary key,
    last_daily_number integer not null default 0,
    constraint order_daily_counters_last_daily_number_nonnegative check (last_daily_number >= 0)
);

insert into order_daily_counters(order_number_date, last_daily_number)
select order_number_date, max(daily_number)
from orders
group by order_number_date;

alter table order_items
    add column order_id_uuid uuid;

alter table wallet_transactions
    add column order_id_uuid uuid;

alter table notifications
    add column order_id_uuid uuid;

alter table reviews
    add column verified_order_id_uuid uuid;

update order_items child
set order_id_uuid = parent.id_uuid
from orders parent
where child.order_id = parent.id;

update wallet_transactions child
set order_id_uuid = parent.id_uuid
from orders parent
where child.order_id = parent.id;

update notifications child
set order_id_uuid = parent.id_uuid
from orders parent
where child.order_id = parent.id;

update reviews child
set verified_order_id_uuid = parent.id_uuid
from orders parent
where child.verified_order_id = parent.id;

alter table order_items
    alter column order_id_uuid set not null;

alter table order_items
    drop constraint order_items_order_id_fkey;

alter table wallet_transactions
    drop constraint wallet_transactions_order_id_fkey;

alter table notifications
    drop constraint notifications_order_id_fkey;

alter table reviews
    drop constraint reviews_verified_order_id_fkey;

drop index wallet_transactions_order_refund_uidx;

alter table orders drop constraint orders_pkey;
alter table orders rename column id to legacy_id;
alter table orders rename column id_uuid to id;
alter table orders add constraint orders_pkey primary key (id);

alter table order_items drop column order_id;
alter table order_items rename column order_id_uuid to order_id;
alter table order_items
    add constraint order_items_order_id_fkey foreign key (order_id) references orders(id) on delete cascade;

alter table wallet_transactions drop column order_id;
alter table wallet_transactions rename column order_id_uuid to order_id;
alter table wallet_transactions
    add constraint wallet_transactions_order_id_fkey foreign key (order_id) references orders(id);

alter table notifications drop column order_id;
alter table notifications rename column order_id_uuid to order_id;
alter table notifications
    add constraint notifications_order_id_fkey foreign key (order_id) references orders(id) on delete cascade;

alter table reviews drop column verified_order_id;
alter table reviews rename column verified_order_id_uuid to verified_order_id;
alter table reviews
    add constraint reviews_verified_order_id_fkey foreign key (verified_order_id) references orders(id);

create unique index wallet_transactions_order_refund_uidx
    on wallet_transactions(order_id, type) where type = 'REFUND';

alter table orders
    drop column legacy_id;

-- Audit records may point at both numeric entities and UUID orders.
alter table audit_logs
    alter column entity_id type varchar(64) using entity_id::text;
