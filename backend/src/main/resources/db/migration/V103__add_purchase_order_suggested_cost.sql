alter table stock_document_lines
    add column if not exists suggested_unit_cost numeric(14, 2);
