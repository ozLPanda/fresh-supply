create table external_api_request_logs (
    id uuid not null,
    credential_id bigint references external_api_credentials(id),
    http_method varchar(8) not null,
    route varchar(200) not null,
    parameters jsonb not null default '{}'::jsonb,
    status varchar(16) not null,
    called_at timestamptz not null,
    primary key (called_at, id)
) partition by range (called_at);

create index external_api_request_logs_credential_called_at_idx
    on external_api_request_logs (credential_id, called_at desc);

do $$
declare
    partition_start timestamptz := date_trunc('month', timezone('Asia/Qyzylorda', now())) at time zone 'Asia/Qyzylorda';
    partition_end timestamptz := partition_start + interval '1 month';
    partition_name text := 'external_api_request_logs_' || to_char(partition_start at time zone 'Asia/Qyzylorda', 'YYYY_MM');
begin
    execute format(
        'create table if not exists %I partition of external_api_request_logs for values from (%L) to (%L)',
        partition_name,
        partition_start,
        partition_end
    );
end $$;
