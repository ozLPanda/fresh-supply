-- Java maps the daily sequence to long, so keep both the order value and its
-- atomic counter as PostgreSQL bigint.
alter table orders
    alter column daily_number type bigint;

alter table order_daily_counters
    alter column last_daily_number type bigint;
