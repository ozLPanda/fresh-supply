alter table price_setting_groups
    add column deleted_at timestamptz,
    add column deleted_by_user_id bigint references users(id);

alter table stock_documents
    add column ai_price_setting_group_id uuid references price_setting_groups(id);

create index stock_documents_active_ai_price_group_idx
    on stock_documents(ai_price_setting_group_id)
    where deleted_at is null and ai_price_setting_group_id is not null;

-- Preserve the latest established assistant selection for existing receipts.
-- Historical sessions remain available for audit and do not hold groups indefinitely.
update stock_documents d
set ai_price_setting_group_id = latest.group_id
from (
    select distinct on (s.receipt_id) s.receipt_id, s.group_id
    from ai_price_sessions s
    join price_setting_groups g on g.id = s.group_id
    order by s.receipt_id, s.created_at desc, s.id desc
) latest
where d.id = latest.receipt_id
  and d.document_type = 'RECEIPT'
  and d.deleted_at is null;
