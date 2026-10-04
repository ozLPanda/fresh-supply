alter table users
    add column personal_discount_percent numeric(5, 2) not null default 0;

alter table users
    add constraint users_personal_discount_percent_range
        check (personal_discount_percent >= 0 and personal_discount_percent <= 100);
