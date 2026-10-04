alter table stock_document_lines
    add column previous_unit_price numeric(14, 2);

alter table orders
    add column price_source_document_id uuid references stock_documents(id);

create index orders_price_source_document_idx
    on orders(price_source_document_id)
    where price_source_document_id is not null;
