create table stock_document_versions (
    id bigserial primary key,
    document_id uuid not null references stock_documents(id) on delete cascade,
    version_number integer not null check (version_number > 0),
    action varchar(24) not null,
    change_summary text not null,
    snapshot_json text not null check (jsonb_typeof(snapshot_json::jsonb) = 'object'),
    changed_by_user_id bigint references users(id),
    created_at timestamptz not null default now(),
    unique (document_id, version_number)
);

create index stock_document_versions_document_created_idx
    on stock_document_versions(document_id, version_number desc);
