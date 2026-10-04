alter table orders add column reservation_expires_at timestamptz;

create index orders_reservation_expiry_idx
    on orders(reservation_expires_at)
    where reservation_expires_at is not null and deleted_at is null;

-- Existing active reservations had no expiry. Give them one final 24-hour period from migration.
update orders o
set reservation_expires_at = now() + interval '24 hours'
where exists (
    select 1
    from stock_reservations reservation
    where reservation.order_id = o.id
      and reservation.status = 'ACTIVE'
)
  and o.deleted_at is null;
