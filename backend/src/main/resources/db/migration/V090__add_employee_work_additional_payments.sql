create table employee_work_additional_payments (
 id bigserial primary key,
 day_id bigint not null references employee_work_days(id) on delete cascade,
 title varchar(255) not null check(length(trim(title)) > 0),
 amount numeric(16,2) not null check(amount > 0)
);
create index employee_work_additional_payments_day on employee_work_additional_payments(day_id);
