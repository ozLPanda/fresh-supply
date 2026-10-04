alter table orders drop constraint if exists orders_payment_method_check;

alter table orders
    add constraint orders_payment_method_check
        check (payment_method in ('BALANCE', 'ON_RECEIPT', 'CASH', 'CASHLESS', 'KASPI_STORE', 'MIXED'));
