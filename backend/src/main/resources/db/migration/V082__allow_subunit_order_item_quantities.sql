alter table order_items
    drop constraint if exists order_items_quantity_check;

alter table order_items
    add constraint order_items_quantity_check check (quantity between 0.001 and 999);
