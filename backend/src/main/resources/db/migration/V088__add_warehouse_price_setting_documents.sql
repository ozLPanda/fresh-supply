alter table stock_documents
    add column price_type varchar(32);

alter table stock_document_lines
    add column source_document_id uuid references stock_documents(id);

create index stock_document_lines_source_document_idx
    on stock_document_lines(source_document_id)
    where source_document_id is not null;
