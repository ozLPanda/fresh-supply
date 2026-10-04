insert into roles(code, name_ru, active)
values ('dima', 'Дима', true)
on conflict (code) do update
set name_ru = excluded.name_ru,
    active = true;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
    'pages.dashboard.view',

    'pages.products.view',
    'products.create',
    'products.read',
    'products.update',
    'products.delete',

    'pages.categories.view',
    'categories.create',
    'categories.read',
    'categories.update',
    'categories.delete',

    'pages.orders.view',
    'orders.read',
    'orders.update',

    'pages.settings.view',

    'pages.procurement.view',
    'procurement.read',
    'procurement.manage',
    'procurement.payments',
    'procurement.history',
    'procurement.create',
    'procurement.update',
    'procurement.status.update',
    'procurement.files.manage',
    'procurement.payments.manage',
    'procurement.history.read'
)
where r.code = 'dima'
on conflict do nothing;
