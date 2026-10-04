create table web_push_subscriptions (
    id bigserial primary key,
    user_id bigint not null references users(id) on delete cascade,
    endpoint text not null unique,
    p256dh varchar(512) not null,
    auth varchar(512) not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index web_push_subscriptions_user_idx on web_push_subscriptions(user_id);
