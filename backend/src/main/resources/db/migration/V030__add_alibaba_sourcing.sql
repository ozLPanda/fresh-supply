create table product_alibaba_sourcing_configs (
    product_id bigint primary key references products(id) on delete cascade,
    enabled boolean not null default false,
    search_query varchar(500),
    min_order_quantity numeric(14, 2),
    min_company_age_years integer,
    selected_offer_id bigint,
    selected_at timestamptz,
    selected_by_user_id bigint references users(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (min_order_quantity is null or min_order_quantity > 0),
    check (min_company_age_years is null or min_company_age_years >= 0)
);

create table alibaba_sourcing_searches (
    id uuid primary key,
    product_id bigint not null references products(id) on delete cascade,
    status varchar(30) not null,
    search_query varchar(500) not null,
    min_order_quantity numeric(14, 2),
    min_company_age_years integer,
    error_message text,
    created_by_user_id bigint references users(id),
    created_at timestamptz not null default now(),
    completed_at timestamptz
);

create table alibaba_sourcing_offers (
    id bigserial primary key,
    search_id uuid not null references alibaba_sourcing_searches(id) on delete cascade,
    position integer not null,
    product_title varchar(500),
    product_url text,
    supplier_name varchar(500) not null,
    supplier_url text,
    country varchar(160),
    company_age_years integer,
    verified_supplier boolean,
    rating numeric(4, 2),
    review_count integer,
    price_from numeric(14, 2),
    price_to numeric(14, 2),
    currency varchar(12),
    minimum_order_quantity numeric(14, 2),
    minimum_order_unit varchar(80),
    description text,
    unique (search_id, position)
);

alter table product_alibaba_sourcing_configs
    add constraint product_alibaba_sourcing_configs_selected_offer_fk
    foreign key (selected_offer_id) references alibaba_sourcing_offers(id) on delete set null;

create index alibaba_sourcing_searches_product_created_idx
    on alibaba_sourcing_searches(product_id, created_at desc);
create index alibaba_sourcing_offers_search_idx on alibaba_sourcing_offers(search_id, position);

insert into permissions(code, entity_name, action_name, name_ru) values
    ('alibabaSourcing.read', 'alibabaSourcing', 'read', 'Просмотр подбора поставщиков Alibaba'),
    ('alibabaSourcing.manage', 'alibabaSourcing', 'manage', 'Управление подбором поставщиков Alibaba')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('alibabaSourcing.read', 'alibabaSourcing.manage')
where r.code = 'administrator'
on conflict do nothing;
