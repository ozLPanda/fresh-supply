insert into permissions(code, entity_name, action_name, name_ru)
values ('deployments.read', 'deployments', 'read', 'Просмотр статуса развёртываний')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'deployments.read'
where r.code = 'administrator'
on conflict do nothing;
