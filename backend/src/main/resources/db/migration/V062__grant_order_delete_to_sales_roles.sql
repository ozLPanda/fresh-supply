insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'orders.delete'
where r.code in ('seller', 'senior_seller')
on conflict do nothing;
