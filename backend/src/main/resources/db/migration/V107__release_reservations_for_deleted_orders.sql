-- A deleted order must not continue to reduce available warehouse stock.
UPDATE stock_reservations reservation
SET status = 'RELEASED',
    released_at = COALESCE(reservation.released_at, NOW())
FROM orders order_record
WHERE reservation.order_id = order_record.id
  AND reservation.status = 'ACTIVE'
  AND order_record.deleted_at IS NOT NULL;
