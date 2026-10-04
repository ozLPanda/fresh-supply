alter table orders
    add column cash_payment_amount numeric(14, 2),
    add column cashless_payment_amount numeric(14, 2);

alter table orders drop constraint if exists orders_payment_method_check;

alter table orders
    add constraint orders_payment_method_check
        check (payment_method in ('BALANCE', 'ON_RECEIPT', 'CASH', 'CASHLESS', 'MIXED'));
