alter table order_items
    add column made_to_order boolean not null default false;

-- Existing rows can only be reconstructed from the current catalogue state.
-- New orders retain this value as an immutable order-item snapshot.
update order_items item
set made_to_order = true
from products product
where item.product_id = product.id
  and product.made_to_order = true;
