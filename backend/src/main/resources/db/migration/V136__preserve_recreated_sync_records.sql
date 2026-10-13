-- Metadata-only repair: preserve recreated active rows when old tombstones arrive later.
create or replace function sync_seed(p_table text,p_uid uuid,p_pk jsonb,p_modified_microseconds text,
                         p_deleted boolean,p_generation bigint,
                         p_aggregate_table text,p_aggregate_pk jsonb,
                         p_observed_microseconds text)
returns void language plpgsql as $$
declare modified timestamptz; observed timestamptz; micros bigint; policy sync_table_policies;
begin
    if current_setting('ovoshi.sync_tracking', true) is distinct from 'off' then
        raise exception 'Sync metadata restore requires tracking suspension';
    end if;
    select * into policy from sync_table_policies where table_name=p_table;
    if not found or jsonb_typeof(p_pk) <> 'object' or p_generation < 1
       or p_uid is null or p_deleted is null then raise exception 'Invalid sync metadata'; end if;
    if (select array_agg(key order by key) from jsonb_object_keys(p_pk) key)
       is distinct from (select array_agg(key order by key) from unnest(policy.pk_columns) key)
       or exists(select 1 from jsonb_each(p_pk) where jsonb_typeof(value) <> 'string') then
        raise exception 'Invalid sync key';
    end if;
    if p_modified_microseconds is not null then
        if p_modified_microseconds !~ '^-?[0-9]{1,19}$' then raise exception 'Invalid sync clock'; end if;
        micros := p_modified_microseconds::bigint;
        modified := timestamptz 'epoch' + (micros/1000000)*interval '1 second'
                    + (micros%1000000)*interval '1 microsecond';
    end if;
    if p_observed_microseconds is not null then
        if p_observed_microseconds !~ '^-?[0-9]{1,19}$' then raise exception 'Invalid sync clock'; end if;
        micros := p_observed_microseconds::bigint;
        observed := timestamptz 'epoch' + (micros/1000000)*interval '1 second'
                    + (micros%1000000)*interval '1 microsecond';
    end if;
    if not p_deleted and sync_business_row(p_table,p_pk) is null then raise exception 'Sync row is absent'; end if;
    if (p_aggregate_table is null) <> (p_aggregate_pk is null)
       or p_aggregate_table is not null and not exists(select 1 from sync_table_policies where table_name=p_aggregate_table) then
        raise exception 'Invalid sync aggregate';
    end if;
    -- Historical tombstones describe a previous incarnation of the same business key.
    -- Only an active import may replace that key's current active identity.
    if not p_deleted then
        delete from sync_rows where table_name=p_table and pk=p_pk and not deleted and uid <> p_uid;
    end if;
    insert into sync_rows(uid,table_name,pk,modified_at,observed_at,deleted,generation,aggregate_table,aggregate_pk)
    values(p_uid,p_table,p_pk,modified,coalesce(observed,modified),p_deleted,p_generation,p_aggregate_table,p_aggregate_pk)
    on conflict(uid) do update set table_name=excluded.table_name,pk=excluded.pk,
        modified_at=excluded.modified_at,observed_at=excluded.observed_at,deleted=excluded.deleted,
        generation=excluded.generation,aggregate_table=excluded.aggregate_table,aggregate_pk=excluded.aggregate_pk;
    if not p_deleted then perform sync_refresh_descendants(p_table,p_pk); end if;
end $$;
