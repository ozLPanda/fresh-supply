insert into permissions(code,entity_name,action_name,name_ru) values
 ('worktime.view_others','worktime','view_others','Просмотр табелей других сотрудников')
on conflict do nothing;

insert into role_permissions(role_id,permission_id)
 select distinct rp.role_id,p.id from role_permissions rp
 join permissions existing on existing.id=rp.permission_id and existing.code='worktime.manage'
 cross join permissions p where p.code='worktime.view_others'
on conflict do nothing;

insert into user_permissions(user_id,permission_id)
 select distinct up.user_id,p.id from user_permissions up
 join permissions existing on existing.id=up.permission_id and existing.code='worktime.manage'
 cross join permissions p where p.code='worktime.view_others'
on conflict do nothing;
