alter table products
    add column created_from_price_import_id uuid
        references product_price_import_sessions(id) on delete set null;

create index products_created_from_price_import_id_idx
    on products(created_from_price_import_id);

-- Link every product that was originally created by exactly one completed import. The
-- product may already have been activated or assigned a category after the import; that
-- must not erase its origin or remove it from the import history.
with import_candidates as (
    select
        product.id as product_id,
        session.id as import_session_id,
        count(*) over (partition by product.id) as candidate_count
    from products product
    join product_price_import_sessions session
        on session.status = 'COMPLETED'
    cross join lateral jsonb_array_elements(
        case
            when jsonb_typeof(session.preview_json::jsonb -> 'rows') = 'array'
                then session.preview_json::jsonb -> 'rows'
            else '[]'::jsonb
        end
    ) preview_row
    where product.created_from_price_import_id is null
      and preview_row ->> 'status' = 'TO_CREATE'
      and preview_row ->> 'sku' = product.sku
)
update products product
set created_from_price_import_id = candidate.import_session_id
from import_candidates candidate
where product.id = candidate.product_id
  and candidate.candidate_count = 1;
