create table whatsapp_contacts (
    id bigserial primary key,
    wa_id varchar(64) not null unique,
    display_name varchar(255),
    last_message_preview varchar(500),
    last_message_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index whatsapp_contacts_last_message_idx
    on whatsapp_contacts(last_message_at desc nulls last, id desc);

create table whatsapp_messages (
    id bigserial primary key,
    contact_id bigint not null references whatsapp_contacts(id) on delete cascade,
    provider_message_id varchar(255) not null unique,
    direction varchar(16) not null,
    type varchar(40) not null,
    body text,
    media_id varchar(255),
    occurred_at timestamptz not null,
    status varchar(30),
    created_at timestamptz not null default now()
);

create index whatsapp_messages_contact_time_idx
    on whatsapp_messages(contact_id, occurred_at desc, id desc);

insert into permissions(code, entity_name, action_name, name_ru) values
    ('pages.whatsapp.view', 'pages.whatsapp', 'view', 'Просмотр страницы WhatsApp'),
    ('whatsapp.read', 'whatsapp', 'read', 'Просмотр контактов и сообщений WhatsApp')
on conflict (code) do nothing;

insert into role_permissions(role_id, permission_id)
select r.id, p.id
from roles r
join permissions p on p.code in ('pages.whatsapp.view', 'whatsapp.read')
where r.code = 'administrator'
on conflict do nothing;
