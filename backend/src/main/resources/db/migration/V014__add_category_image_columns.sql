alter table categories
    add column if not exists image_file_name varchar(260),
    add column if not exists image_original_file_name varchar(260),
    add column if not exists image_file_path varchar(500);
