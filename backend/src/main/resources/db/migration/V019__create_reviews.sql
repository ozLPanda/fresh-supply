create table reviews (
    id bigserial primary key,
    product_id bigint not null references products(id),
    user_id bigint not null references users(id),
    author_name varchar(160) not null,
    rating integer not null check (rating between 1 and 5),
    content text not null,
    status varchar(24) not null default 'PENDING',
    verified boolean not null default false,
    verified_order_id bigint references orders(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index reviews_product_status_created_idx on reviews(product_id, status, created_at desc);
create index reviews_status_created_idx on reviews(status, created_at desc);
create index reviews_user_idx on reviews(user_id);

create table review_images (
    id bigserial primary key,
    review_id bigint not null references reviews(id) on delete cascade,
    file_name varchar(255) not null,
    file_path varchar(500) not null,
    original_file_name varchar(255) not null,
    file_size bigint not null,
    sort_order integer not null default 0,
    created_at timestamptz not null default now()
);

create index review_images_review_idx on review_images(review_id, sort_order);

create table review_messages (
    id bigserial primary key,
    review_id bigint not null references reviews(id) on delete cascade,
    user_id bigint references users(id),
    author_name varchar(160) not null,
    author_type varchar(24) not null,
    content text not null,
    created_at timestamptz not null default now()
);

create index review_messages_review_created_idx on review_messages(review_id, created_at);

insert into permissions(code, entity_name, action_name, name_ru) values
('reviews.read', 'reviews', 'read', 'Просмотр отзывов'),
('reviews.update', 'reviews', 'update', 'Модерация отзывов'),
('reviews.reply', 'reviews', 'reply', 'Ответы на отзывы'),
('pages.reviews.view', 'pages.reviews', 'view', 'Отзывы')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.code = 'administrator'
  and p.code in ('reviews.read', 'reviews.update', 'reviews.reply', 'pages.reviews.view')
on conflict do nothing;
