alter table order_items
    drop constraint if exists order_items_quantity_check;

alter table order_items
    alter column quantity type numeric(6, 3) using quantity::numeric(6, 3);

alter table order_items
    add constraint order_items_quantity_check check (quantity between 1 and 999);
