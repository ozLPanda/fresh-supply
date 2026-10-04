create table procurement_company_notes (
    id bigserial primary key,
    company_id bigint not null references procurement_companies(id) on delete cascade,
    content text not null,
    author_user_id bigint references users(id) on delete set null,
    author_name varchar(255) not null,
    created_at timestamptz not null default now(),
    check (length(trim(content)) between 1 and 10000)
);

create index procurement_company_notes_company_created_idx
    on procurement_company_notes(company_id, created_at asc);
