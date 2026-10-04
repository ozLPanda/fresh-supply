insert into permissions(code, entity_name, action_name, name_ru)
values
    ('audit.read', 'audit', 'read', 'Просмотр журнала действий'),
    ('pages.audit.view', 'pages.audit', 'view', 'Страница журнала действий')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('audit.read', 'pages.audit.view')
where r.code = 'administrator'
on conflict do nothing;
