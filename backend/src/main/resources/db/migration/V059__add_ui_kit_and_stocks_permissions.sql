insert into permissions(code, entity_name, action_name, name_ru)
values
    ('pages.uiKit.view', 'pages.uiKit', 'view', 'UI Kit'),
    ('pages.stocks.view', 'pages.stocks', 'view', 'Работа с остатками')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('pages.uiKit.view', 'pages.stocks.view')
where r.code = 'administrator'
on conflict do nothing;

delete from role_permissions rp
using roles r, permissions p
where rp.role_id = r.id
  and rp.permission_id = p.id
  and r.code = 'dima'
  and p.code = 'pages.stocks.view';
