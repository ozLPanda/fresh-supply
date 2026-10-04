insert into permissions(code, entity_name, action_name, name_ru)
values
    ('integrations.1c.credentials.manage', 'integrations.1c.credentials', 'manage', 'Управление ключами 1С')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'integrations.1c.credentials.manage'
where r.code = 'administrator'
on conflict do nothing;
