update product_price_change_snapshots snapshot
set category_name = category.name_ru
from categories category
where snapshot.category_id = category.id
  and (snapshot.category_name is null or btrim(snapshot.category_name) = '');
