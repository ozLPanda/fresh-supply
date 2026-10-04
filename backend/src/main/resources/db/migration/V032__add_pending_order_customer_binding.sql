alter table orders
    add column pending_customer_email varchar(180),
    add column pending_customer_phone varchar(40);

create index orders_pending_customer_email_idx on orders(pending_customer_email)
    where user_id is null and pending_customer_email is not null;

create index orders_pending_customer_phone_idx on orders(pending_customer_phone)
    where user_id is null and pending_customer_phone is not null;
