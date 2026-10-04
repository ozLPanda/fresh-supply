alter table orders add column if not exists deleted_at timestamptz;

create index if not exists orders_deleted_at_created_at_idx
    on orders(deleted_at, created_at desc);

insert into permissions(code, entity_name, action_name, name_ru)
values ('orders.delete', 'orders', 'delete', 'Удаление заказов')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'orders.delete'
where r.code in ('administrator', 'dima')
on conflict do nothing;
