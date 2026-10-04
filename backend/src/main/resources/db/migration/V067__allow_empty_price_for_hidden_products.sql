alter table products
    drop constraint if exists products_price_check;

alter table products
    alter column price drop not null;

alter table products
    add constraint products_price_positive_or_empty_check
        check (price is null or price > 0);
