alter table orders
    add column sale_currency varchar(3) not null default 'KZT',
    add column currency_exchange_rate numeric(18, 6) not null default 1;
