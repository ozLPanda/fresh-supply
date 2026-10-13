-- Tracking belongs to each installation; it is never restored as ordinary business data.
create table sync_instance (
    singleton boolean primary key default true check (singleton),
    instance_id uuid not null default gen_random_uuid()
);
insert into sync_instance(singleton) values (true);

create table sync_table_policies (
    table_name text primary key,
    pk_columns text[] not null,
    projection_columns text[] not null default '{}',
    aggregate_table text,
    aggregate_fk text,
    aggregate_key text not null default 'id',
    touch_parent boolean not null default true
);

create table sync_rows (
    uid uuid primary key default gen_random_uuid(),
    table_name text not null,
    pk jsonb not null check (jsonb_typeof(pk) = 'object'),
    modified_at timestamptz,
    observed_at timestamptz,
    deleted boolean not null default false,
    generation bigint not null default 1 check (generation > 0),
    aggregate_table text,
    aggregate_pk jsonb,
    check ((aggregate_table is null) = (aggregate_pk is null))
);
create unique index sync_rows_active_key on sync_rows(table_name, pk) where not deleted;
create index sync_rows_table_key on sync_rows(table_name, pk);
create index sync_rows_aggregate on sync_rows(aggregate_table, aggregate_pk);

create function sync_key(data jsonb, columns text[]) returns jsonb
language sql immutable strict as $$
    select jsonb_object_agg(column_name, to_jsonb(data ->> column_name))
    from unnest(columns) column_name
$$;

create function sync_observed(data jsonb) returns timestamptz
language plpgsql immutable as $$
begin
    -- An observation is not a guarantee that every historical mutation was timestamped.
    return coalesce(nullif(data ->> 'updated_at', '')::timestamptz,
                    nullif(data ->> 'created_at', '')::timestamptz);
end $$;

-- Read only identity, owner and timestamp fields, never inline photos or document JSON.
create function sync_projection(p_table text,p_row anyelement) returns jsonb
language plpgsql stable as $$
declare expression text; result jsonb;
begin
    select 'jsonb_build_object(' || string_agg(format('%L,to_jsonb(($1).%I)',column_name,column_name),',') || ')'
      into expression from sync_table_policies p,unnest(p.projection_columns) column_name
      where p.table_name=p_table;
    if expression is null then return null; end if;
    execute 'select ' || expression into result using p_row;
    return result;
end $$;

create function sync_business_row(p_table text, p_key jsonb) returns jsonb
language plpgsql stable as $$
declare result jsonb; predicate text;
begin
    select string_agg(format('t.%I = %L', key, value), ' and ')
      into predicate from jsonb_each_text(p_key);
    if predicate is null or not exists(select 1 from sync_table_policies where table_name=p_table) then
        return null;
    end if;
    execute format('select sync_projection(%L,t) from public.%I t where %s', p_table, p_table, predicate) into result;
    return result;
end $$;

create function sync_aggregate(p_table text, data jsonb, depth integer default 0) returns jsonb
language plpgsql stable as $$
declare policy sync_table_policies; parent_key jsonb; parent_data jsonb; ancestor jsonb;
begin
    if depth >= 12 then raise exception 'Sync aggregate cycle'; end if;
    select * into policy from sync_table_policies where table_name=p_table;
    -- A stock document belongs to an order first, otherwise to its price-setting batch.
    -- Children and versions resolve through this same owner, keeping each batch coherent.
    if p_table='stock_documents' and data ->> 'source_order_id' is null
       and data ->> 'price_setting_group_id' is not null then
        policy.aggregate_table := 'price_setting_groups';
        policy.aggregate_fk := 'price_setting_group_id';
        policy.aggregate_key := 'id';
    end if;
    if policy.aggregate_table is null or data ->> policy.aggregate_fk is null then return null; end if;
    parent_key := jsonb_build_object(policy.aggregate_key, data ->> policy.aggregate_fk);
    parent_data := sync_business_row(policy.aggregate_table, parent_key);
    if parent_data is not null then
        ancestor := sync_aggregate(policy.aggregate_table, parent_data, depth+1);
    else
        -- A cascading delete may already have removed the parent business row.
        select jsonb_build_object('table', aggregate_table, 'key', aggregate_pk) into ancestor
          from sync_rows where table_name=policy.aggregate_table and pk=parent_key
          and aggregate_table is not null order by deleted, generation desc limit 1;
    end if;
    return coalesce(ancestor, jsonb_build_object('table', policy.aggregate_table, 'key', parent_key));
end $$;

-- Reparenting changes the current aggregate of unchanged descendants as well. Refresh only
-- actual owned FK children; their identities/clocks and deleted historical owners stay intact.
create function sync_refresh_descendants(p_table text,p_key jsonb,depth integer default 0)
returns void language plpgsql as $$
declare child_policy sync_table_policies; child_data jsonb; child_key jsonb; owner jsonb;
        foreign_column text; parent_value text;
begin
    if depth >= 12 then raise exception 'Sync descendant cycle'; end if;
    for child_policy in select * from sync_table_policies
        where aggregate_table=p_table
           or (p_table='price_setting_groups' and table_name='stock_documents')
        order by table_name
    loop
        foreign_column := case when p_table='price_setting_groups' and child_policy.table_name='stock_documents'
                            then 'price_setting_group_id' else child_policy.aggregate_fk end;
        parent_value := p_key ->> child_policy.aggregate_key;
        if parent_value is null or not foreign_column=any(child_policy.projection_columns) then continue; end if;
        for child_data in execute format('select sync_projection(%L,t) from public.%I t where t.%I=%L',
                child_policy.table_name,child_policy.table_name,foreign_column,parent_value)
        loop
            child_key := sync_key(child_data,child_policy.pk_columns);
            owner := sync_aggregate(child_policy.table_name,child_data);
            update sync_rows set aggregate_table=owner ->> 'table',aggregate_pk=owner -> 'key'
                where table_name=child_policy.table_name and pk=child_key and not deleted
                and (aggregate_table is distinct from owner ->> 'table'
                     or aggregate_pk is distinct from owner -> 'key');
            perform sync_refresh_descendants(child_policy.table_name,child_key,depth+1);
        end loop;
    end loop;
end $$;

create function sync_touch_aggregate(aggregate jsonb, changed_at timestamptz, historical boolean default false)
returns void language plpgsql as $$
begin
    if aggregate is null then return; end if;
    if historical then
        update sync_rows set observed_at=greatest(observed_at, changed_at)
         where table_name=aggregate ->> 'table' and pk=aggregate -> 'key' and not deleted;
    else
        update sync_rows set modified_at=greatest(modified_at + interval '1 microsecond', changed_at),
                             observed_at=greatest(observed_at, modified_at + interval '1 microsecond', changed_at)
         where table_name=aggregate ->> 'table' and pk=aggregate -> 'key' and not deleted;
    end if;
end $$;

create function sync_track_row() returns trigger language plpgsql as $$
declare data jsonb; old_key jsonb; new_key jsonb; old_owner jsonb; new_owner jsonb;
        policy sync_table_policies; row_uid uuid; changed_at timestamptz := clock_timestamp();
        next_generation bigint; prior_clock timestamptz; file_row sync_rows; file_clock timestamptz;
begin
    if current_setting('ovoshi.sync_tracking', true) = 'off' then
        if TG_OP='DELETE' then return OLD; else return NEW; end if;
    end if;
    if TG_OP='UPDATE' and NEW is not distinct from OLD then return NEW; end if;
    select * into policy from sync_table_policies where table_name=TG_TABLE_NAME;
    if TG_OP <> 'INSERT' then
        old_key := sync_key(sync_projection(TG_TABLE_NAME,OLD), policy.pk_columns);
        old_owner := sync_aggregate(TG_TABLE_NAME, sync_projection(TG_TABLE_NAME,OLD));
        select uid,modified_at into row_uid,prior_clock from sync_rows
         where table_name=TG_TABLE_NAME and pk=old_key and not deleted for update;
    end if;
    changed_at := greatest(clock_timestamp(), prior_clock + interval '1 microsecond');
    if TG_OP='DELETE' then
        if row_uid is null then
            select coalesce(max(generation),0)+1 into next_generation from sync_rows
             where table_name=TG_TABLE_NAME and pk=old_key;
            insert into sync_rows(table_name,pk,modified_at,observed_at,deleted,generation,aggregate_table,aggregate_pk)
            values(TG_TABLE_NAME,old_key,changed_at,changed_at,true,next_generation,
                   old_owner ->> 'table',old_owner -> 'key');
        else
            update sync_rows set deleted=true,modified_at=changed_at,observed_at=changed_at,
                   aggregate_table=old_owner ->> 'table',aggregate_pk=old_owner -> 'key'
             where uid=row_uid;
        end if;
    else
        data := sync_projection(TG_TABLE_NAME,NEW);
        new_key := sync_key(data, policy.pk_columns);
        new_owner := sync_aggregate(TG_TABLE_NAME, data);
        if row_uid is null then
            -- Existing imported keys can deliberately retain their UID while tracking was off.
            select uid,modified_at into row_uid,prior_clock from sync_rows
             where table_name=TG_TABLE_NAME and pk=new_key and not deleted for update;
        end if;
        changed_at := greatest(clock_timestamp(), prior_clock + interval '1 microsecond');
        if row_uid is null then
            select coalesce(max(generation),0)+1 into next_generation from sync_rows
             where table_name=TG_TABLE_NAME and pk=new_key;
            insert into sync_rows(table_name,pk,modified_at,observed_at,generation,aggregate_table,aggregate_pk)
            values(TG_TABLE_NAME,new_key,changed_at,changed_at,next_generation,
                   new_owner ->> 'table',new_owner -> 'key');
        else
            update sync_rows set pk=new_key,modified_at=changed_at,observed_at=changed_at,
                   aggregate_table=new_owner ->> 'table',aggregate_pk=new_owner -> 'key'
             where uid=row_uid;
        end if;
    end if;
    -- Equal-size text edits replace an existing object without changing any procurement_files
    -- business column. Its audited UPDATE is the trusted transaction-local mutation signal.
    if TG_OP='INSERT' and TG_TABLE_NAME='audit_logs'
       and data ->> 'action'='UPDATE' and data ->> 'entity_type'='PROCUREMENT_FILE' then
        select * into file_row from sync_rows
         where table_name='procurement_files' and not deleted
           and pk=jsonb_build_object('id',data ->> 'entity_id') for update;
        if found then
            file_clock := greatest(changed_at,file_row.modified_at + interval '1 microsecond');
            update sync_rows set modified_at=file_clock,observed_at=greatest(observed_at,file_clock)
             where uid=file_row.uid;
            if file_row.aggregate_table is not null then
                perform sync_touch_aggregate(jsonb_build_object('table',file_row.aggregate_table,'key',file_row.aggregate_pk),file_clock);
            end if;
        end if;
    end if;
    if policy.touch_parent then
        perform sync_touch_aggregate(old_owner,changed_at);
        if new_owner is distinct from old_owner then perform sync_touch_aggregate(new_owner,changed_at); end if;
    end if;
    if TG_OP='UPDATE' and (old_owner is distinct from new_owner or old_key is distinct from new_key) then
        perform sync_refresh_descendants(TG_TABLE_NAME,new_key);
    end if;
    if TG_OP='DELETE' then return OLD; else return NEW; end if;
end $$;

-- Native restore/merge may preserve remote clocks and UIDs only while its local transaction
-- explicitly suspends tracking. This helper does not grant an unauthenticated HTTP write API.
create function sync_seed(p_table text,p_uid uuid,p_pk jsonb,p_modified_microseconds text,
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
    delete from sync_rows where table_name=p_table and pk=p_pk and not deleted and uid <> p_uid;
    insert into sync_rows(uid,table_name,pk,modified_at,observed_at,deleted,generation,aggregate_table,aggregate_pk)
    values(p_uid,p_table,p_pk,modified,coalesce(observed,modified),p_deleted,p_generation,p_aggregate_table,p_aggregate_pk)
    on conflict(uid) do update set table_name=excluded.table_name,pk=excluded.pk,
        modified_at=excluded.modified_at,observed_at=excluded.observed_at,deleted=excluded.deleted,
        generation=excluded.generation,aggregate_table=excluded.aggregate_table,aggregate_pk=excluded.aggregate_pk;
    if not p_deleted then perform sync_refresh_descendants(p_table,p_pk); end if;
end $$;

create function sync_seed(p_table text,p_uid uuid,p_pk jsonb,p_modified_microseconds text,
                         p_deleted boolean,p_generation bigint,
                         p_aggregate_table text default null,p_aggregate_pk jsonb default null)
returns void language sql as $$
    select sync_seed(p_table,p_uid,p_pk,p_modified_microseconds,p_deleted,p_generation,
                              p_aggregate_table,p_aggregate_pk,null)
$$;

create function sync_install_tracking() returns void language plpgsql as $$
declare item record; data jsonb; row_key jsonb; owner jsonb; observation timestamptz;
begin
    for item in
        select c.relname, array_agg(a.attname::text order by key.ord) as keys
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        join pg_index idx on idx.indrelid=c.oid and idx.indisprimary
        cross join lateral unnest(idx.indkey) with ordinality key(attnum,ord)
        join pg_attribute a on a.attrelid=c.oid and a.attnum=key.attnum
        where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition
          and c.relname not like 'sync\_%' escape '\'
          and c.relname not in ('auth_sessions','flyway_schema_history','web_push_subscriptions',
              'external_api_credentials','external_api_credential_permissions','external_api_request_logs')
        group by c.relname
    loop
        insert into sync_table_policies(table_name,pk_columns) values(item.relname,item.keys)
        on conflict(table_name) do update set pk_columns=excluded.pk_columns;
    end loop;
    -- Only real owned aggregates. A generic FK-to-parent rule would make notification creation
    -- or a shopping cart overwrite the account's profile version.
    update sync_table_policies p set aggregate_table=v.parent,aggregate_fk=v.fk
    from (values
        ('order_items','orders','order_id'),
        ('stock_documents','orders','source_order_id'),
        ('stock_document_lines','stock_documents','document_id'),
        ('stock_document_versions','stock_documents','document_id'),
        ('stock_movements','stock_documents','document_id'),
        ('stock_cost_layers','stock_documents','source_document_id'),
        ('stock_reservations','orders','order_id'),
        ('stock_ledger_revisions','stock_movements','movement_id'),
        ('purchase_order_allocations','stock_documents','document_id'),
        ('wallet_transactions','wallets','wallet_id'),
        ('product_images','products','product_id'),
        ('product_alibaba_sourcing_configs','products','product_id'),
        ('product_search_embeddings','products','product_id'),
        ('category_search_embeddings','categories','category_id'),
        ('review_images','reviews','review_id'),
        ('review_messages','reviews','review_id'),
        ('procurement_companies','procurement_projects','project_id'),
        ('procurement_company_links','procurement_companies','company_id'),
        ('procurement_company_notes','procurement_companies','company_id'),
        ('procurement_files','procurement_projects','project_id'),
        ('procurement_payments','procurement_projects','project_id'),
        ('procurement_status_history','procurement_projects','project_id'),
        ('employee_work_intervals','employee_work_days','day_id'),
        ('employee_work_additional_payments','employee_work_days','day_id'),
        ('regular_buyer_aliases','regular_buyers','buyer_id'),
        ('role_permissions','roles','role_id'),
        ('user_roles','users','user_id'),
        ('user_permissions','users','user_id'),
        ('supplier_import_items','supplier_import_jobs','job_id'),
        ('alibaba_sourcing_offers','alibaba_sourcing_searches','search_id'),
        ('product_price_statistics_imports','product_price_import_sessions','import_session_id'),
        ('product_price_change_snapshots','product_price_statistics_imports','statistics_import_id'),
        ('order_assistant_sessions','orders','order_id')
    ) v(child,parent,fk) where p.table_name=v.child;

    update sync_table_policies p set projection_columns=(
        select array_agg(a.attname::text order by a.attnum)
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
        where n.nspname='public' and c.relname=p.table_name
        and a.attname=any(p.pk_columns || array[p.aggregate_fk,'updated_at','created_at']
            || case when p.table_name='audit_logs' then array['action','entity_type','entity_id']
                    when p.table_name='stock_documents' then array['price_setting_group_id'] else '{}'::text[] end)
    );
    update sync_table_policies set touch_parent=false
     where table_name in ('product_search_embeddings','category_search_embeddings');

    -- Flyway's migration lock does not stop other backend processes from writing business rows.
    -- Freeze DML in a stable order before backfill; locks live until the surrounding transaction
    -- commits together with trigger installation, leaving no untracked write window.
    for item in select table_name from sync_table_policies order by table_name loop
        execute format('lock table public.%I in share row exclusive mode',item.table_name);
    end loop;

    for item in select * from sync_table_policies order by table_name loop
        for data in execute format('select sync_projection(%L,t) from public.%I t',item.table_name,item.table_name) loop
            row_key := sync_key(data,item.pk_columns);
            -- Historical times remain explicitly uncertain. Never manufacture an update at migration time.
            insert into sync_rows(table_name,pk,observed_at) values(item.table_name,row_key,sync_observed(data))
            on conflict(table_name,pk) where not deleted do nothing;
        end loop;
    end loop;
    for item in select * from sync_table_policies order by table_name loop
        for data in execute format('select sync_projection(%L,t) from public.%I t',item.table_name,item.table_name) loop
            row_key := sync_key(data,item.pk_columns);
            owner := sync_aggregate(item.table_name,data);
            observation := sync_observed(data);
            update sync_rows set aggregate_table=owner ->> 'table',aggregate_pk=owner -> 'key'
                where table_name=item.table_name and pk=row_key and not deleted;
            if item.touch_parent then perform sync_touch_aggregate(owner,observation,true); end if;
        end loop;
        execute format('drop trigger if exists ovoshi_sync_track on public.%I',item.table_name);
        execute format('create trigger ovoshi_sync_track after insert or update or delete on public.%I '
                       'for each row execute function sync_track_row()',item.table_name);
    end loop;
end $$;
select sync_install_tracking();
