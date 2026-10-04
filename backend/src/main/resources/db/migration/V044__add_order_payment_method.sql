alter table orders
    add column payment_method varchar(30);

update orders
set payment_method = case
    when created_by_user_id is null and payment_status = 'PAID' then 'BALANCE'
    else 'ON_RECEIPT'
end;

alter table orders
    alter column payment_method set not null,
    add constraint orders_payment_method_check
        check (payment_method in ('BALANCE', 'ON_RECEIPT'));
