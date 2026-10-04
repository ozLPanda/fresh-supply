create table procurement_projects (
    id bigserial primary key,
    name varchar(500) not null,
    purchase_information text,
    status varchar(40) not null default 'DRAFT',
    created_by_user_id bigint references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table procurement_companies (
    id bigserial primary key,
    project_id bigint not null references procurement_projects(id) on delete cascade,
    name varchar(500) not null,
    market text,
    market_since_year integer,
    reviews_from_year integer,
    reviews_to_year integer,
    comment text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (market_since_year is null or market_since_year between 1800 and 3000),
    check (reviews_from_year is null or reviews_from_year between 1800 and 3000),
    check (reviews_to_year is null or reviews_to_year between 1800 and 3000),
    check (reviews_to_year is null or reviews_from_year is null or reviews_to_year >= reviews_from_year)
);

create table procurement_company_links (
    id bigserial primary key,
    company_id bigint not null references procurement_companies(id) on delete cascade,
    name varchar(500) not null,
    url text not null,
    sort_order integer not null default 0
);

create table procurement_files (
    id bigserial primary key,
    project_id bigint not null references procurement_projects(id) on delete cascade,
    company_id bigint references procurement_companies(id) on delete cascade,
    display_name varchar(500) not null,
    file_name varchar(500) not null,
    file_path text not null,
    original_file_name varchar(1000) not null,
    content_type varchar(255),
    file_size bigint not null,
    uploaded_by_user_id bigint references users(id) on delete set null,
    created_at timestamptz not null default now()
);

create table procurement_payments (
    id bigserial primary key,
    project_id bigint not null references procurement_projects(id) on delete cascade,
    amount numeric(14, 2) not null check (amount > 0),
    currency varchar(12) not null,
    paid_at date not null,
    comment text,
    created_by_user_id bigint references users(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table procurement_status_history (
    id bigserial primary key,
    project_id bigint not null references procurement_projects(id) on delete cascade,
    old_status varchar(40),
    new_status varchar(40) not null,
    comment text,
    actor_user_id bigint references users(id) on delete set null,
    actor_name varchar(255) not null,
    created_at timestamptz not null default now()
);

create index procurement_projects_status_updated_idx on procurement_projects(status, updated_at desc);
create index procurement_companies_project_idx on procurement_companies(project_id);
create index procurement_company_links_company_idx on procurement_company_links(company_id, sort_order);
create index procurement_files_project_idx on procurement_files(project_id, company_id);
create index procurement_payments_project_idx on procurement_payments(project_id, paid_at desc);
create index procurement_status_history_project_idx on procurement_status_history(project_id, created_at desc);

insert into permissions(code, entity_name, action_name, name_ru) values
    ('pages.procurement.view', 'pages.procurement', 'view', 'Страница закупок из Китая'),
    ('procurement.read', 'procurement', 'read', 'Просмотр закупок из Китая'),
    ('procurement.manage', 'procurement', 'manage', 'Управление закупками из Китая'),
    ('procurement.payments', 'procurement', 'payments', 'Управление оплатами закупок из Китая'),
    ('procurement.history', 'procurement', 'history', 'Просмотр истории статусов закупок из Китая'),
    ('procurement.create', 'procurement', 'create', 'Создание закупок из Китая'),
    ('procurement.update', 'procurement', 'update', 'Редактирование закупок из Китая'),
    ('procurement.status.update', 'procurement', 'status.update', 'Смена статусов закупок из Китая'),
    ('procurement.files.manage', 'procurement', 'files.manage', 'Управление файлами закупок из Китая'),
    ('procurement.payments.manage', 'procurement', 'payments.manage', 'Управление оплатами закупок из Китая'),
    ('procurement.history.read', 'procurement', 'history.read', 'Просмотр истории статусов закупок из Китая')
on conflict (code) do nothing;

insert into roles(code, name_ru, active) values
    ('china_sourcing', 'Поиск Китай', true)
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in (
    'pages.procurement.view', 'procurement.read', 'procurement.manage', 'procurement.payments', 'procurement.history',
    'procurement.create', 'procurement.update', 'procurement.status.update', 'procurement.files.manage',
    'procurement.payments.manage', 'procurement.history.read'
)
where r.code in ('administrator', 'china_sourcing')
on conflict do nothing;
