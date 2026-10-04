insert into permissions(code, entity_name, action_name, name_ru)
values ('commerce.invoices.create', 'commerce.invoices', 'create', 'Временные накладные из корзины')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code = 'commerce.invoices.create'
where r.code in ('administrator', 'installer')
on conflict do nothing;
