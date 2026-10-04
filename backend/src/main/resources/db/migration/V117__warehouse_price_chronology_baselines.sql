-- Preserve the pre-ledger price independently of editable/cancelled document lines.
-- This migration does not recalculate product prices, stock or order costs.
alter table stock_document_lines
    add column card_price_before_posting numeric(14, 2),
    add column restore_card_price_on_cancel boolean not null default false;

create table warehouse_price_baselines (
    id uuid primary key,
    product_id bigint not null references products(id),
    price_type varchar(32) not null,
    baseline_price numeric(14, 2),
    source_document_id uuid references stock_documents(id),
    review_reason varchar(500),
    created_at timestamptz not null default now(),
    unique (product_id, price_type)
);

with first_setting as (
    select distinct on (line.product_id, document.price_type)
           line.product_id, document.price_type, line.previous_unit_price,
           document.id as document_id, document.posted_at
    from stock_document_lines line
    join stock_documents document on document.id = line.document_id
    where document.document_type = 'PRICE_SETTING'
      and document.price_type is not null and document.posted_at is not null
    order by line.product_id, document.price_type, document.posted_at,
             document.created_at, document.id, line.id
)
insert into warehouse_price_baselines
    (id, product_id, price_type, baseline_price, source_document_id, review_reason)
select gen_random_uuid(), first_setting.product_id, first_setting.price_type,
       first_setting.previous_unit_price, first_setting.document_id,
       case when first_setting.price_type = 'RETAIL' and first_setting.previous_unit_price is null
            then 'Неизвестна начальная розничная цена; требуется сверка'
            when exists (
           select 1 from stock_document_lines historical_line
           join stock_documents historical_document on historical_document.id = historical_line.document_id
           where historical_line.product_id = first_setting.product_id
             and historical_document.price_type = first_setting.price_type
             and historical_document.document_type = 'PRICE_SETTING'
             and historical_document.posted_at is not null
             and ((select count(*) from stock_document_versions version
                   where version.document_id = historical_document.id and version.action = 'POST') > 1
                  or exists (select 1 from stock_document_versions version
                             where version.document_id = historical_document.id
                               and version.action = 'UPDATE'
                               and version.created_at > historical_document.posted_at))
       ) then 'История цены содержит изменённые циклы проведения; требуется сверка начальной цены'
       end
from first_setting;

-- Retain card edits/imported prices which an old posting explicitly overwrote.
-- Ambiguous reposted histories are flagged above and are not applied automatically.
with price_chain as (
    select line.id, line.previous_unit_price,
           lag(line.unit_price) over (
               partition by line.product_id, document.price_type
               order by document.posted_at, document.created_at, document.id, line.id
           ) as preceding_price,
           row_number() over (
               partition by line.product_id, document.price_type
               order by document.posted_at, document.created_at, document.id, line.id
           ) as position
    from stock_document_lines line
    join stock_documents document on document.id = line.document_id
    where document.document_type = 'PRICE_SETTING' and document.posted_at is not null
)
update stock_document_lines line
set card_price_before_posting = price_chain.previous_unit_price,
    restore_card_price_on_cancel = price_chain.position > 1
        and price_chain.previous_unit_price is distinct from price_chain.preceding_price
from price_chain where price_chain.id = line.id;
