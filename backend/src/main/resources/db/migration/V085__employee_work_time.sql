create table employee_work_settings (
 user_id bigint primary key references users(id), daily_rate numeric(14,2) not null check(daily_rate >= 0),
 norm_minutes integer not null check(norm_minutes between 1 and 1440), version bigint not null default 0,
 updated_by bigint not null references users(id), updated_at timestamptz not null default now()
);
create table employee_work_payments (
 id bigserial primary key, user_id bigint not null references users(id),
 from_date date not null, to_date date not null, paid_on date not null,
 amount numeric(16,2) not null check(amount >= 0), note varchar(1000) not null default '',
 created_by bigint not null references users(id), created_at timestamptz not null default now(),
 cancelled_at timestamptz, cancelled_by bigint references users(id), cancel_reason varchar(1000),
 check(from_date <= to_date)
);
create table employee_work_days (
 id bigserial primary key, user_id bigint not null references users(id), work_date date not null,
 daily_rate numeric(14,2) not null check(daily_rate >= 0), norm_minutes integer not null check(norm_minutes between 1 and 1440),
 minutes integer not null check(minutes between 1 and 1440), amount numeric(14,2) not null check(amount >= 0),
 note varchar(1000) not null default '', version bigint not null default 0,
 payment_id bigint references employee_work_payments(id),
 updated_by bigint not null references users(id), updated_at timestamptz not null default now(),
 unique(user_id, work_date)
);
create table employee_work_intervals (
 day_id bigint not null references employee_work_days(id) on delete cascade,
 start_minute integer not null check(start_minute between 0 and 1439),
 end_minute integer not null check(end_minute between 1 and 1440),
 primary key(day_id, start_minute), check(end_minute > start_minute)
);
create index employee_work_days_unpaid on employee_work_days(user_id, work_date) where payment_id is null;
create index employee_work_payments_user on employee_work_payments(user_id, paid_on);
insert into permissions(code,entity_name,action_name,name_ru) values
 ('pages.worktime.view','pages.worktime','view','Личный табель и начисления'),
 ('worktime.manage','worktime','manage','Табели сотрудников, оклады и выплаты') on conflict do nothing;
insert into role_permissions(role_id,permission_id)
 select distinct rp.role_id,p.id from role_permissions rp join permissions old on old.id=rp.permission_id
 cross join permissions p where old.code like 'pages.%' and p.code='pages.worktime.view' on conflict do nothing;
insert into user_permissions(user_id,permission_id)
 select distinct up.user_id,p.id from user_permissions up join permissions old on old.id=up.permission_id
 cross join permissions p where old.code like 'pages.%' and p.code='pages.worktime.view' on conflict do nothing;
insert into role_permissions(role_id,permission_id)
 select r.id,p.id from roles r cross join permissions p where r.code='administrator'
 and p.code in ('pages.worktime.view','worktime.manage') on conflict do nothing;
