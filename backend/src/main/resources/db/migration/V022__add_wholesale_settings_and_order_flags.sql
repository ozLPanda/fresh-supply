insert into project_settings (key, value)
values ('commerce.wholesale.minQuantity', '10')
on conflict (key) do nothing;

alter table orders
    add column if not exists wholesale boolean not null default false;

alter table order_items
    add column if not exists wholesale boolean not null default false;
