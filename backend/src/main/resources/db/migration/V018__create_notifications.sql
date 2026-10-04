create table notifications (
    id bigserial primary key,
    user_id bigint not null references users(id) on delete cascade,
    type varchar(40) not null,
    title varchar(200) not null,
    message varchar(600) not null,
    order_id bigint references orders(id) on delete cascade,
    action_url varchar(300),
    read_at timestamptz,
    created_at timestamptz not null default now()
);

create index notifications_user_created_idx
    on notifications(user_id, created_at desc);

create index notifications_user_unread_idx
    on notifications(user_id, created_at desc)
    where read_at is null;
