-- A zero opening balance is an intentional baseline: the product was checked and is out of stock.
-- Keep this movement so the item remains visible in balances and subsequent returns are tracked.
alter table stock_movements
    drop constraint if exists stock_movements_quantity_check;
