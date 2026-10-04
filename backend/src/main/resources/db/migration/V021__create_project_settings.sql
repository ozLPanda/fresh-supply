create table if not exists project_settings (
    key varchar(120) primary key,
    value text not null,
    updated_at timestamptz not null default now()
);

insert into project_settings (key, value)
values ('search.ai.enabled', 'true')
on conflict (key) do nothing;
