alter table orders
    add column paid_total numeric(14,2);

update orders
set paid_total = total;

alter table orders
    alter column paid_total set not null,
    add constraint orders_paid_total_nonnegative check (paid_total >= 0);

alter table order_items
    add column confirmed_unit_price numeric(14,2),
    add column confirmed_line_total numeric(14,2);

update order_items
set confirmed_unit_price = unit_price,
    confirmed_line_total = line_total;

alter table order_items
    alter column confirmed_unit_price set not null,
    alter column confirmed_line_total set not null,
    add constraint order_items_confirmed_unit_price_positive check (confirmed_unit_price > 0),
    add constraint order_items_confirmed_line_total_positive check (confirmed_line_total > 0);
