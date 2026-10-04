create table product_view_events (
    id bigserial primary key,
    product_id bigint not null references products(id) on delete cascade,
    user_id bigint references users(id) on delete set null,
    visitor_key varchar(160) not null,
    viewed_at timestamptz not null default now()
);
create index product_view_events_viewed_at_idx on product_view_events(viewed_at);
create index product_view_events_product_visitor_idx
    on product_view_events(product_id, visitor_key, viewed_at desc);

create table audit_logs (
    id bigserial primary key,
    actor_user_id bigint references users(id) on delete set null,
    actor_name varchar(160) not null,
    action varchar(80) not null,
    entity_type varchar(80) not null,
    entity_id bigint,
    description varchar(500) not null,
    created_at timestamptz not null default now()
);
create index audit_logs_created_at_idx on audit_logs(created_at desc);
