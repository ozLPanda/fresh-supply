alter table stock_documents
    add column effective_time time;

-- Existing documents historically took effect at the beginning of their business date.
update stock_documents
set effective_time = time '00:00'
where effective_date is not null
  and effective_time is null;
