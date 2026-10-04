create extension if not exists vector;

create table product_search_embeddings (
    product_id bigint primary key references products(id) on delete cascade,
    model varchar(160) not null,
    content_hash varchar(64) not null,
    embedding vector(768) not null,
    updated_at timestamptz not null default now()
);

create table category_search_embeddings (
    category_id bigint primary key references categories(id) on delete cascade,
    model varchar(160) not null,
    content_hash varchar(64) not null,
    embedding vector(768) not null,
    updated_at timestamptz not null default now()
);

create index product_search_embeddings_embedding_hnsw
    on product_search_embeddings using hnsw (embedding vector_cosine_ops);

create index category_search_embeddings_embedding_hnsw
    on category_search_embeddings using hnsw (embedding vector_cosine_ops);
