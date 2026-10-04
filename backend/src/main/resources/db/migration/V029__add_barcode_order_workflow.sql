alter table orders
    alter column user_id drop not null,
    add column created_by_user_id bigint references users(id),
    add column price_tier varchar(30) not null default 'RETAIL';

update orders
set price_tier = 'WHOLESALE'
where wholesale = true;

alter table order_items
    add column price_tier varchar(30) not null default 'RETAIL';

update order_items
set price_tier = 'WHOLESALE'
where wholesale = true;

create index orders_created_by_user_id_idx on orders(created_by_user_id);
