alter table procurement_company_notes
    add column updated_at timestamptz not null default now();
