create table search_query_logs (
    id bigserial primary key,
    search_query varchar(500) not null,
    source varchar(32) not null,
    category_slug varchar(180),
    user_id bigint references users(id) on delete set null,
    searched_at timestamptz not null
);

create index idx_search_query_logs_searched_at on search_query_logs (searched_at desc);
create index idx_search_query_logs_user_id on search_query_logs (user_id);
