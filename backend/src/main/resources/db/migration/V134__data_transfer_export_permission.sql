insert into permissions(code, entity_name, action_name, name_ru) values
    ('data.export', 'data', 'export', 'Экспорт всех данных и файлов')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id from roles r
join permissions p on p.code = 'data.export'
where r.code = 'administrator'
on conflict do nothing;
