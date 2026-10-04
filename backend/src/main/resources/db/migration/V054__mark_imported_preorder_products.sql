UPDATE products
SET
    name_ru = btrim(regexp_replace(name_ru, '^[[:space:]]*на[[:space:]]+заказ[[:space:]:—-]*', '', 'i')),
    name_kk = btrim(regexp_replace(name_kk, '^[[:space:]]*на[[:space:]]+заказ[[:space:]:—-]*', '', 'i')),
    made_to_order = true
WHERE created_from_price_import_id IS NOT NULL
  AND name_ru ~* '^[[:space:]]*на[[:space:]]+заказ([[:space:]:—-]+|$)';
