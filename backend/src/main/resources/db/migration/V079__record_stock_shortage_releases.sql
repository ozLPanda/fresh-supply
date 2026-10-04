alter table order_items
    add column stock_shortage_quantity numeric(14, 3) not null default 0
        check (stock_shortage_quantity >= 0),
    add column stock_shortage_released_by_user_id bigint references users(id),
    add column stock_shortage_released_at timestamptz,
    add column stock_shortage_comment varchar(2000);

create index order_items_stock_shortage_idx
    on order_items(order_id)
    where stock_shortage_quantity > 0;

insert into permissions(code, entity_name, action_name, name_ru) values
('warehouse.negative_stock', 'warehouse', 'negative_stock', 'Отпуск с расхождением по остаткам')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'warehouse.negative_stock'
where r.code = 'administrator'
on conflict do nothing;
