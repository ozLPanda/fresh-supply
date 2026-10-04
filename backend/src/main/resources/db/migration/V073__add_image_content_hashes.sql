alter table product_images add column if not exists content_hash varchar(64);

alter table categories add column if not exists image_content_hash varchar(64);
