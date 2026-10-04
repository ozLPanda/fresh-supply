-- A document keeps its number while moving from draft to posted or cancelled.
-- Number older visible drafts in creation order without changing their status.
do $$
declare
    draft_id uuid;
begin
    for draft_id in
        select id
        from stock_documents
        where document_number is null and deleted_at is null
        order by created_at, id
    loop
        update stock_documents
        set document_number = 'СКЛ-' || nextval('stock_document_number_seq')
        where id = draft_id;
    end loop;
end $$;
