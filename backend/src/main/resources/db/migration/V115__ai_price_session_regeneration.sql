alter table ai_price_sessions
    add column parent_session_id uuid references ai_price_sessions(id);

create unique index ai_price_sessions_parent_session_id_uidx
    on ai_price_sessions (parent_session_id)
    where parent_session_id is not null;
