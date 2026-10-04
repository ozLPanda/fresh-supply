-- Clean installation baseline through V015.
-- Flyway applies this only to a new database. Existing V001-V015 migrations stay
-- unchanged so databases that already applied them continue to validate.
-- Schema/security match V001-V014; V012 and V015 catalog data are intentionally
-- omitted. V016 and later still provide all subsequent schema and system defaults.
-- One administrator is retained, including the password correction from V013.

-- V001__create_permissions_table.sql
create table permissions (id bigserial primary key, code varchar(120) not null unique, entity_name varchar(80) not null, action_name varchar(80) not null, name_ru varchar(160) not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- V002__create_roles_table.sql
create table roles (id bigserial primary key, code varchar(80) not null unique, name_ru varchar(160) not null, name_kk varchar(160), active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- V003__create_users_table.sql
create table users (id bigserial primary key, name varchar(160) not null, email varchar(180) not null unique, phone varchar(40), password_hash varchar(120) not null, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

-- V004__create_user_roles_table.sql
create table user_roles (user_id bigint not null references users(id) on delete cascade, role_id bigint not null references roles(id) on delete cascade, primary key (user_id, role_id));

-- V005__create_role_permissions_table.sql
create table role_permissions (role_id bigint not null references roles(id) on delete cascade, permission_id bigint not null references permissions(id) on delete cascade, primary key (role_id, permission_id));

-- V006__create_user_permissions_table.sql
create table user_permissions (user_id bigint not null references users(id) on delete cascade, permission_id bigint not null references permissions(id) on delete cascade, primary key (user_id, permission_id));

-- V007__create_categories_table.sql
create table categories (id bigserial primary key, parent_id bigint references categories(id), name_ru varchar(220) not null, name_kk varchar(220) not null, description_ru text, description_kk text, slug varchar(220) not null unique, sort_order integer not null default 0, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

-- V008__create_products_table.sql
create table products (id bigserial primary key, sku varchar(120) not null unique, name_ru varchar(260) not null, name_kk varchar(260) not null, short_description_ru varchar(500), short_description_kk varchar(500), description_ru text, description_kk text, price numeric(14,2) not null check (price > 0), wholesale_price numeric(14,2), bulk_wholesale_price numeric(14,2), category_id bigint references categories(id), active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz);

-- V009__create_product_images_table.sql
create table product_images (id bigserial primary key, product_id bigint not null references products(id) on delete cascade, file_name varchar(260) not null, original_file_name varchar(260) not null, file_path varchar(500) not null, sort_order integer not null default 0, main_image boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- V010__create_integration_logs_table.sql
create table integration_logs (id bigserial primary key, source_system varchar(80) not null, operation varchar(120) not null, status varchar(60) not null, message text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- V011__seed_security.sql
insert into permissions(code, entity_name, action_name, name_ru) values
('products.create','products','create','Создание товаров'),('products.read','products','read','Просмотр товаров'),('products.update','products','update','Редактирование товаров'),('products.delete','products','delete','Удаление товаров'),
('categories.create','categories','create','Создание категорий'),('categories.read','categories','read','Просмотр категорий'),('categories.update','categories','update','Редактирование категорий'),('categories.delete','categories','delete','Удаление категорий'),
('users.create','users','create','Создание пользователей'),('users.read','users','read','Просмотр пользователей'),('users.update','users','update','Редактирование пользователей'),('users.delete','users','delete','Удаление пользователей'),
('roles.create','roles','create','Создание ролей'),('roles.read','roles','read','Просмотр ролей'),('roles.update','roles','update','Редактирование ролей'),('roles.delete','roles','delete','Удаление ролей'),
('pages.dashboard.view','pages.dashboard','view','Главная'),('pages.products.view','pages.products','view','Товары'),('pages.categories.view','pages.categories','view','Категории'),('pages.users.view','pages.users','view','Пользователи'),('pages.roles.view','pages.roles','view','Роли'),('pages.settings.view','pages.settings','view','Настройки'),('pages.administration.view','pages.administration','view','Администрирование'),('pages.externalSoftware.view','pages.externalSoftware','view','Стороннее ПО');
insert into roles(code, name_ru, name_kk, active) values ('administrator','Администратор','Әкімші',true);
insert into role_permissions(role_id, permission_id) select r.id, p.id from roles r cross join permissions p where r.code='administrator';
insert into users(name, email, phone, password_hash, active) values ('Администратор','admin@active.kz','+7 777 459 32 33','$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',true);
insert into user_roles(user_id, role_id) select u.id, r.id from users u cross join roles r where u.email='admin@active.kz' and r.code='administrator';

-- V013__update_admin_password_hash.sql
update users
set password_hash = '$2b$10$VkLsdTAQ9IO0zqpJm4Wi5OclYcLSBAispUP3xXonH8Vjt7mmagh0G'
where email = 'admin@active.kz';

-- V014__add_category_image_columns.sql
alter table categories
    add column if not exists image_file_name varchar(260),
    add column if not exists image_original_file_name varchar(260),
    add column if not exists image_file_path varchar(500);
