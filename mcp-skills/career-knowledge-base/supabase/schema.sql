-- ─── Supabase pgvector Schema ────────────────────────────────────────────────
-- Execution Order: Apply once via Supabase SQL Editor or 'supabase db push'

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Table for JD/Reference document chunks
create table if not exists jd_documents (
  id             uuid        primary key default gen_random_uuid(),
  doc_id         text        not null unique,            -- "<drive_file_id>_chunk_<idx>"
  doc_type       text        not null check (doc_type in ('jd', 'reference')),
  title          text        not null,
  chunk_index    integer     not null,
  text           text        not null,
  metadata       jsonb       not null default '{}',
  tags           text[]      not null default '{}',
  embedding      vector(1536),                           -- Dimension for text-embedding-3-small
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 3. Vector Index (IVFFlat — cosine distance, recommended lists = doc count / 10)
create index if not exists jd_documents_embedding_idx
  on jd_documents
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. Automatic updated_at refresh trigger
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists jd_documents_updated_at on jd_documents;
create trigger jd_documents_updated_at
  before update on jd_documents
  for each row execute function set_updated_at();

-- 5. RPC Function for similarity search
--    Called by ChatQnAAgent → MCP career-knowledge-base → similaritySearch()
create or replace function match_jd_documents(
  query_embedding  vector(1536),
  match_count      int     default 5,
  filter_doc_type  text    default 'all',   -- 'jd' | 'reference' | 'all'
  filter_tags      text[]  default null     -- If null, no tag filtering is applied
)
returns table (
  doc_id       text,
  doc_type     text,
  title        text,
  chunk_index  integer,
  score        float,
  text         text,
  metadata     jsonb
)
language plpgsql
as $$
begin
  return query
  select
    d.doc_id,
    d.doc_type,
    d.title,
    d.chunk_index,
    (1 - (d.embedding <=> query_embedding))::float as score,
    d.text,
    d.metadata
  from jd_documents d
  where d.embedding is not null
    and (filter_doc_type = 'all' or d.doc_type = filter_doc_type)
    and (filter_tags is null or d.tags && filter_tags)
  order by d.embedding <=> query_embedding
  limit match_count;
end;
$$;