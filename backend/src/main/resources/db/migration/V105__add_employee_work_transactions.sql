create table employee_work_transactions (
 id bigserial primary key,
 user_id bigint not null references users(id),
 type varchar(20) not null check(type in ('PAYMENT', 'LOAN')),
 occurred_on date not null,
 amount numeric(16,2) not null check(amount > 0),
 note varchar(1000) not null default '',
 created_by bigint not null references users(id),
 created_at timestamptz not null default now(),
 cancelled_at timestamptz,
 cancelled_by bigint references users(id),
 cancel_reason varchar(1000)
);

create index employee_work_transactions_user_occurred_on
 on employee_work_transactions(user_id, occurred_on desc);
