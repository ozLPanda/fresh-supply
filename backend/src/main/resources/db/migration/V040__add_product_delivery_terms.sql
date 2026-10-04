alter table products
    add column made_to_order boolean not null default false,
    add column delivery_days_from integer,
    add column delivery_days_to integer,
    add constraint products_delivery_days_from_positive check (delivery_days_from is null or delivery_days_from > 0),
    add constraint products_delivery_days_to_positive check (delivery_days_to is null or delivery_days_to > 0),
    add constraint products_delivery_days_range check (
        delivery_days_from is null
        or delivery_days_to is null
        or delivery_days_from <= delivery_days_to
    );
