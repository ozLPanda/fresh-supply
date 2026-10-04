alter table stock_document_lines
    add column source_order_item_id bigint references order_items(id),
    add column unit_price numeric(14, 2);

create index stock_document_lines_source_order_item_idx
    on stock_document_lines(source_order_item_id)
    where source_order_item_id is not null;
