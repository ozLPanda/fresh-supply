alter table stock_documents
    add column deleted_at timestamptz,
    add column deleted_by_user_id bigint references users(id);

create index stock_documents_active_warehouse_created_idx
    on stock_documents(warehouse_id, created_at desc)
    where deleted_at is null;
