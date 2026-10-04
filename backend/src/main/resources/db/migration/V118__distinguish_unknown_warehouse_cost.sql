-- A missing FIFO cost must not silently become today's catalogue cost in profit reports.
alter table order_items
    add column warehouse_cost_calculated boolean not null default false;

update order_items item set warehouse_cost_calculated = true
where exists (
    select 1 from stock_documents document
    join stock_movements movement on movement.document_id = document.id
    where document.source_order_id = item.order_id and movement.product_id = item.product_id
      and document.document_type = 'SALE' and document.deleted_at is null
      and document.status = 'POSTED' and movement.movement_type = 'SALE'
);
