-- Old Satu IDs are unrelated to the new products.id sequence. Keep explicit
-- mappings to product identity so editing/reusing a SKU cannot move old links.
create table legacy_product_urls (
    legacy_id varchar(32) primary key,
    product_id bigint not null references products(id) on delete cascade
);
create index idx_legacy_product_urls_product_id on legacy_product_urls(product_id);

-- Verified against the indexed title and the current public SKU 559 card.
insert into legacy_product_urls(legacy_id, product_id)
select '131540811', id from products where sku = '559' and deleted_at is null;
