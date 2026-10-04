create table gpt_api_usage (
    id bigserial primary key,
    response_id varchar(160) unique,
    feature varchar(100) not null,
    model varchar(160) not null,
    status varchar(40) not null,
    http_status integer,
    input_tokens bigint,
    output_tokens bigint,
    total_tokens bigint,
    cached_input_tokens bigint,
    cache_write_tokens bigint,
    reasoning_output_tokens bigint,
    duration_ms bigint not null check (duration_ms >= 0),
    created_at timestamptz not null default now(),
    constraint gpt_api_usage_tokens_nonnegative check (
        (input_tokens is null or input_tokens >= 0)
        and (output_tokens is null or output_tokens >= 0)
        and (total_tokens is null or total_tokens >= 0)
        and (cached_input_tokens is null or cached_input_tokens >= 0)
        and (cache_write_tokens is null or cache_write_tokens >= 0)
        and (reasoning_output_tokens is null or reasoning_output_tokens >= 0)
    )
);

create index gpt_api_usage_created_at_idx on gpt_api_usage (created_at desc);
create index gpt_api_usage_feature_created_at_idx on gpt_api_usage (feature, created_at desc);
create index gpt_api_usage_model_created_at_idx on gpt_api_usage (model, created_at desc);
