create table external_api_credentials (
    id bigserial primary key,
    name varchar(160) not null,
    access_code varchar(128) not null unique,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint external_api_credentials_expiry_after_creation
        check (expires_at is null or expires_at > created_at)
);

create table external_api_credential_permissions (
    external_api_credential_id bigint not null
        references external_api_credentials(id) on delete cascade,
    permission_id bigint not null references permissions(id),
    primary key (external_api_credential_id, permission_id)
);

create index external_api_credential_permissions_permission_id_idx
    on external_api_credential_permissions(permission_id);
