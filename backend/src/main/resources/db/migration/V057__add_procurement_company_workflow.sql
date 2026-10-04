alter table procurement_companies
    add column if not exists status varchar(32),
    add column if not exists decision_comment text;

update procurement_companies
set status = 'FOUND'
where status is null;

alter table procurement_companies
    alter column status set default 'FOUND',
    alter column status set not null;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'procurement_companies_status_valid'
          and conrelid = 'procurement_companies'::regclass
    ) then
        alter table procurement_companies
            add constraint procurement_companies_status_valid
            check (status in ('FOUND', 'AWAITING_DOCUMENTS', 'OFFER_RECEIVED', 'SELECTED', 'REJECTED'));
    end if;
end
$$;
