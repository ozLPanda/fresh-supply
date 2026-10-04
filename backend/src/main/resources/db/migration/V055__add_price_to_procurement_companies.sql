alter table procurement_companies
    add column if not exists price numeric(14, 2);

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'procurement_companies_price_nonnegative'
          and conrelid = 'procurement_companies'::regclass
    ) then
        alter table procurement_companies
            add constraint procurement_companies_price_nonnegative
            check (price is null or price >= 0);
    end if;
end
$$;
