-- Exact links preserve historical posting cycles instead of matching FIFO layers by document.
alter table stock_movements add column reverses_movement_id uuid references stock_movements(id);
alter table stock_movements add column source_line_id bigint;
alter table stock_movements add column inventory_quantity numeric(14,3);
alter table stock_movements add column original_quantity numeric(14,3);
alter table stock_movements add column original_unit_cost numeric(18,6);
alter table stock_movements add column reconciled_shortage_quantity numeric(14,3) not null default 0;
alter table stock_movements add column allow_stock_shortage boolean not null default false;
alter table stock_cost_layers add column source_movement_id uuid references stock_movements(id);
update stock_movements set original_quantity = quantity, original_unit_cost = unit_cost;
-- Never guess between multiple legacy posting cycles. Unresolved links are reported by preview.
with candidates as (
 select r.id reversal_id, m.id movement_id,
        count(*) over (partition by r.id) reversal_candidates,
        count(*) over (partition by m.id) movement_candidates
 from stock_movements r join stock_movements m
 on r.document_id=m.document_id and r.product_id=m.product_id
 and r.movement_type='CANCEL_' || m.movement_type
 and r.quantity=-m.quantity and r.created_at>=m.created_at
)
update stock_movements r set reverses_movement_id=c.movement_id
from candidates c where r.id=c.reversal_id and c.reversal_candidates=1 and c.movement_candidates=1;
with candidates as (
 select l.id layer_id, m.id movement_id,
        count(*) over(partition by l.id) layer_candidates,
        count(*) over(partition by m.id) movement_candidates
 from stock_cost_layers l join stock_movements m
 on l.source_document_id=m.document_id and l.product_id=m.product_id
 and l.warehouse_id=m.warehouse_id and l.original_quantity=m.quantity
 and l.unit_cost is not distinct from m.unit_cost and m.quantity>0
)
update stock_cost_layers l set source_movement_id=c.movement_id from candidates c
where l.id=c.layer_id and c.layer_candidates=1 and c.movement_candidates=1;
with candidates as (
 select m.id movement_id, l.id line_id, l.quantity,
 count(*) over(partition by m.id) candidates
 from stock_movements m join stock_documents d on d.id=m.document_id
 join stock_document_lines l on l.document_id=d.id and l.product_id=m.product_id
 where d.status='POSTED' and m.movement_type=d.document_type
 and (d.cancelled_at is null or m.created_at>d.cancelled_at)
)
update stock_movements m set source_line_id=c.line_id,
 inventory_quantity=case when m.movement_type='INVENTORY' then c.quantity else null end
from candidates c where m.id=c.movement_id and c.candidates=1;
-- Legacy zero-delta inventories had no movement. Preserve their fixed-count semantics as well.
insert into stock_movements(id,warehouse_id,document_id,product_id,quantity,unit_cost,movement_type,
 occurred_at,created_at,source_line_id,inventory_quantity,original_quantity,original_unit_cost)
select gen_random_uuid(),d.warehouse_id,d.id,l.product_id,0,l.unit_cost,'INVENTORY',
 coalesce((d.effective_date+coalesce(d.effective_time,time '00:00:00')) at time zone 'Asia/Almaty',d.posted_at,d.created_at),
 coalesce(d.posted_at,d.created_at),l.id,l.quantity,0,l.unit_cost
from stock_documents d join stock_document_lines l on l.document_id=d.id
where d.document_type='INVENTORY' and d.status='POSTED' and d.deleted_at is null
and not exists(select 1 from stock_movements m where m.document_id=d.id and m.product_id=l.product_id
 and m.movement_type='INVENTORY' and (d.cancelled_at is null or m.created_at>d.cancelled_at));
update stock_movements m set allow_stock_shortage=true
from stock_documents d where d.id=m.document_id and m.movement_type='SALE'
and exists(select 1 from order_items i where i.order_id=d.source_order_id
 and i.product_id=m.product_id and i.stock_shortage_released_at is not null);
create unique index stock_movements_reversal_uidx on stock_movements(reverses_movement_id) where reverses_movement_id is not null;
create unique index stock_cost_layers_movement_uidx on stock_cost_layers(source_movement_id) where source_movement_id is not null;
create index stock_movements_replay_idx on stock_movements(warehouse_id,product_id,occurred_at,created_at,id);
create table stock_ledger_revisions (
 id uuid primary key, replay_id uuid not null, movement_id uuid not null references stock_movements(id),
 before_quantity numeric(14,3), after_quantity numeric(14,3),
 before_unit_cost numeric(18,6), after_unit_cost numeric(18,6),
 before_shortage numeric(14,3), after_shortage numeric(14,3),
 created_at timestamptz not null default now()
);
create index stock_ledger_revisions_movement_idx on stock_ledger_revisions(movement_id,created_at);

-- Preserve an already accepted historical deficit, never grant an unlimited inventory waiver.
-- Partition the running balance at every active opening, with the same total order as replay.
with active as (
 select m.* from stock_movements m join stock_documents d on d.id=m.document_id
 where d.status='POSTED' and d.deleted_at is null
 and (d.cancelled_at is null or m.created_at>d.cancelled_at)
 and m.reverses_movement_id is null and m.movement_type not like 'CANCEL_%'
 and not exists(select 1 from stock_movements r where r.reverses_movement_id=m.id)
), epochs as (
 select a.*, count(*) filter(where movement_type='OPENING_BALANCE') over (
   partition by warehouse_id,product_id order by occurred_at,created_at,id rows unbounded preceding) epoch
 from active a
), running as (
 select e.*, sum(quantity) over(partition by warehouse_id,product_id,epoch
   order by occurred_at,created_at,id rows unbounded preceding) balance
 from epochs e
)
update stock_movements m set reconciled_shortage_quantity=least(-r.quantity,-r.balance)
from running r where r.id=m.id and r.movement_type='SALE' and r.quantity<0 and r.balance<0
and exists(select 1 from epochs inventory where inventory.warehouse_id=r.warehouse_id
 and inventory.product_id=r.product_id and inventory.epoch=r.epoch and inventory.movement_type='INVENTORY'
 and (inventory.occurred_at,inventory.created_at,inventory.id)<(r.occurred_at,r.created_at,r.id)
 and inventory.created_at>r.created_at);
