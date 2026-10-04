alter table procurement_companies
    add column if not exists price_currency varchar(3);

update procurement_companies
set price_currency = 'KZT'
where price is not null
  and price_currency is null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'procurement_companies_price_currency_valid'
          and conrelid = 'procurement_companies'::regclass
    ) then
        alter table procurement_companies
            add constraint procurement_companies_price_currency_valid
            check (
                (price is null and price_currency is null)
                or (price is not null and price_currency in ('KZT', 'USD', 'CNY'))
            );
    end if;
end
$$;
