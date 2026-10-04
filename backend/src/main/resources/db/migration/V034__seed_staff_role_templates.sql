insert into roles(code, name_ru, active) values
    ('seller', 'Продавец', true),
    ('senior_seller', 'Старший продавец', true),
    ('accountant', 'Бухгалтер', true),
    ('moderator', 'Модератор', true)
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
    'orders.read', 'orders.update', 'products.read', 'categories.read',
    'pages.dashboard.view', 'pages.orders.view', 'pages.products.view', 'pages.categories.view'
)
where r.code = 'seller'
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
    'orders.read', 'orders.update', 'products.read', 'products.update', 'categories.read',
    'pages.dashboard.view', 'pages.orders.view', 'pages.products.view', 'pages.categories.view'
)
where r.code = 'senior_seller'
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
    'balances.manage', 'orders.read', 'users.read',
    'pages.dashboard.view', 'pages.orders.view', 'pages.users.view'
)
where r.code = 'accountant'
on conflict do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('reviews.read', 'reviews.update', 'reviews.reply', 'pages.reviews.view')
where r.code = 'moderator'
on conflict do nothing;
