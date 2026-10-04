update products
set name_ru = btrim(regexp_replace(
            name_ru,
            $$[[:space:]]*\([[:space:]]*арт(икул)?\.?[[:space:]]*[-:№]?[[:space:]]*[[:digit:]]+[[:space:]]*\)$$,
            '',
            'gi')),
    name_kk = btrim(regexp_replace(
            name_kk,
            $$[[:space:]]*\([[:space:]]*арт(икул)?\.?[[:space:]]*[-:№]?[[:space:]]*[[:digit:]]+[[:space:]]*\)$$,
            '',
            'gi')),
    updated_at = now()
where deleted_at is null
  and (
      name_ru ~* $$\([[:space:]]*арт(икул)?\.?[[:space:]]*[-:№]?[[:space:]]*[[:digit:]]+[[:space:]]*\)$$
      or name_kk ~* $$\([[:space:]]*арт(икул)?\.?[[:space:]]*[-:№]?[[:space:]]*[[:digit:]]+[[:space:]]*\)$$
  );
