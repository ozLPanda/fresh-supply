alter table orders
    add column transfer_payment_amount numeric(14, 2),
    add column card_payment_amount numeric(14, 2),
    add column qr_payment_amount numeric(14, 2);
