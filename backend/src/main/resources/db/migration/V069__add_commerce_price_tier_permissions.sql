insert into permissions(code, entity_name, action_name, name_ru)
values
    ('commerce.prices.wholesale', 'commerce.prices', 'wholesale', 'Оптовые цены в корзине'),
    ('commerce.prices.bulkWholesale', 'commerce.prices', 'bulkWholesale', 'Крупно-оптовые цены в корзине'),
    ('commerce.prices.sko', 'commerce.prices', 'sko', 'Цены СКО в корзине')
on conflict (code) do nothing;

insert into roles(code, name_ru, active)
values ('installer', 'Монтажник', true)
on conflict (code) do update
set name_ru = excluded.name_ru,
    active = true;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
    'commerce.prices.wholesale',
    'commerce.prices.bulkWholesale',
    'commerce.prices.sko'
)
where r.code in ('administrator', 'installer')
on conflict do nothing;
