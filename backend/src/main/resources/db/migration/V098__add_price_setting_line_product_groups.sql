alter table stock_document_lines
    add column if not exists product_group_name varchar(160);
