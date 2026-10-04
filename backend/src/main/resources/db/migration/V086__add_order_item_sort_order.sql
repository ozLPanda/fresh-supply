alter table order_items
    add column sort_order integer not null default 0;

with numbered_items as (
    select id, row_number() over (partition by order_id order by id) - 1 as position
    from order_items
)
update order_items
set sort_order = numbered_items.position
from numbered_items
where order_items.id = numbered_items.id;

create index order_items_order_sort_order_idx on order_items(order_id, sort_order, id);
