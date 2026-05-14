-- ============================================================
-- readmycareer.com — Supabase Main Schema
-- Apply via Supabase SQL Editor or `supabase db push`
-- Prerequisites: uuid-ossp, pgvector extensions enabled
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- SECTION A: Shared Utility
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- ============================================================
-- SECTION B: Profiles
-- ============================================================

-- Extends auth.users; one row per Google OAuth user.
-- Auto-populated by handle_new_user trigger on first sign-in.
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT,
  avatar_url    TEXT,
  locale        TEXT        NOT NULL DEFAULT 'ko' CHECK (locale IN ('ko', 'en')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-creates profile row from Google OAuth metadata on first sign-in
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

DROP TRIGGER IF EXISTS profiles_updated_at ON profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: owner read"
  ON profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles: owner update"
  ON profiles FOR UPDATE
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- ============================================================
-- SECTION C: Resumes
-- ============================================================

-- Stores PDF-parsed or manually-entered resume data per user.
-- resume_json shape matches ResumeJson in agents/types.ts.
CREATE TABLE IF NOT EXISTS resumes (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  input_method  TEXT        NOT NULL DEFAULT 'pdf_upload'
                            CHECK (input_method IN ('pdf_upload', 'manual')),
  resume_json   JSONB       NOT NULL DEFAULT '{}',
  raw_text      TEXT,
  file_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resumes_user_id_idx ON resumes(user_id);

DROP TRIGGER IF EXISTS resumes_updated_at ON resumes;
CREATE TRIGGER resumes_updated_at
  BEFORE UPDATE ON resumes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resumes: owner all"
  ON resumes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SECTION D: Career Plans (max 3 active+completed per user)
-- ============================================================

-- Central record linking a user's goal, JD text, and resume.
-- jd_text: 50–10,000 characters per US-004 validation rules.
-- status lifecycle: active → completed | archived.
-- 3-plan hard limit enforced by enforce_career_plan_limit trigger below.
-- Archived plans are excluded from the count (archiving frees a slot).
CREATE TABLE IF NOT EXISTS career_plans (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resume_id       UUID        REFERENCES resumes(id) ON DELETE SET NULL,
  title           TEXT        NOT NULL DEFAULT 'Career Plan',
  target_role     TEXT        NOT NULL,
  target_company  TEXT        NOT NULL DEFAULT '',
  jd_text         TEXT        NOT NULL
                              CHECK (char_length(jd_text) >= 50 AND char_length(jd_text) <= 10000),
  duration_weeks  INTEGER     NOT NULL CHECK (duration_weeks BETWEEN 1 AND 52),
  start_date      DATE        NOT NULL,
  end_date        DATE,
  status          TEXT        NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active', 'completed', 'archived')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS career_plans_user_id_idx     ON career_plans(user_id);
CREATE INDEX IF NOT EXISTS career_plans_user_status_idx ON career_plans(user_id, status);

DROP TRIGGER IF EXISTS career_plans_updated_at ON career_plans;
CREATE TRIGGER career_plans_updated_at
  BEFORE UPDATE ON career_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Prevents inserting a 4th active/completed plan per user.
-- Archived plans do not count toward the limit.
CREATE OR REPLACE FUNCTION enforce_career_plan_limit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  plan_count INTEGER;
BEGIN
  SELECT COUNT(*)
    INTO plan_count
    FROM career_plans
   WHERE user_id = NEW.user_id
     AND status IN ('active', 'completed');

  IF plan_count >= 3 THEN
    RAISE EXCEPTION
      'Career plan limit reached: archive an existing plan to create a new one.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS check_career_plan_limit ON career_plans;
CREATE TRIGGER check_career_plan_limit
  BEFORE INSERT ON career_plans
  FOR EACH ROW EXECUTE FUNCTION enforce_career_plan_limit();

ALTER TABLE career_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "career_plans: owner all"
  ON career_plans FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SECTION E: Gap Analyses
-- ============================================================

-- One row per analysis run; re-analysis appends a new row.
-- current_skills/missing_skills/priorities match GapAnalysisOutput in agents/types.ts.
-- summary_json holds the full output for forward-compat without schema changes.
CREATE TABLE IF NOT EXISTS gap_analyses (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  career_plan_id       UUID        NOT NULL REFERENCES career_plans(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_role          TEXT        NOT NULL,
  overall_match_score  INTEGER     NOT NULL CHECK (overall_match_score BETWEEN 0 AND 100),
  current_skills       JSONB       NOT NULL DEFAULT '[]',
  missing_skills       JSONB       NOT NULL DEFAULT '[]',
  priorities           JSONB       NOT NULL DEFAULT '[]',
  summary              TEXT        NOT NULL DEFAULT '',
  summary_json         JSONB       NOT NULL DEFAULT '{}',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gap_analyses_career_plan_id_idx ON gap_analyses(career_plan_id);
CREATE INDEX IF NOT EXISTS gap_analyses_user_id_idx        ON gap_analyses(user_id);

DROP TRIGGER IF EXISTS gap_analyses_updated_at ON gap_analyses;
CREATE TRIGGER gap_analyses_updated_at
  BEFORE UPDATE ON gap_analyses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE gap_analyses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gap_analyses: owner all"
  ON gap_analyses FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SECTION F: Roadmaps
-- ============================================================

-- One roadmap per career plan (UNIQUE constraint).
-- Re-analysis UPDATEs the existing row rather than inserting a new one,
-- keeping weekly_tasks FKs stable.
-- phases_json: CareerPlanOutput.weeks + timeline as JSONB.
-- markdown_export: pre-rendered "Copy as Markdown" content (US-021).
CREATE TABLE IF NOT EXISTS roadmaps (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  career_plan_id   UUID        NOT NULL REFERENCES career_plans(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gap_analysis_id  UUID        REFERENCES gap_analyses(id) ON DELETE SET NULL,
  summary          TEXT        NOT NULL DEFAULT '',
  week_count       INTEGER     NOT NULL DEFAULT 0 CHECK (week_count >= 0),
  phases_json      JSONB       NOT NULL DEFAULT '[]',
  timeline_json    JSONB       NOT NULL DEFAULT '{"milestones":[],"gantt_rows":[]}',
  markdown_export  TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (career_plan_id)
);

CREATE INDEX IF NOT EXISTS roadmaps_career_plan_id_idx ON roadmaps(career_plan_id);
CREATE INDEX IF NOT EXISTS roadmaps_user_id_idx        ON roadmaps(user_id);

DROP TRIGGER IF EXISTS roadmaps_updated_at ON roadmaps;
CREATE TRIGGER roadmaps_updated_at
  BEFORE UPDATE ON roadmaps
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE roadmaps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roadmaps: owner all"
  ON roadmaps FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SECTION G: Weekly Tasks
-- ============================================================

-- One row per week per roadmap.
-- action_items: JSONB array of TodoItem objects from agents/types.ts.
--   Shape: { id, title, description, category, priority,
--            estimated_hours, done, resources[] }
-- is_completed is maintained by the application when all action_items[*].done = true.
CREATE TABLE IF NOT EXISTS weekly_tasks (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  roadmap_id    UUID        NOT NULL REFERENCES roadmaps(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_number   INTEGER     NOT NULL CHECK (week_number >= 1),
  date_start    DATE        NOT NULL,
  date_end      DATE        NOT NULL,
  theme         TEXT        NOT NULL DEFAULT '',
  milestone     TEXT,
  action_items  JSONB       NOT NULL DEFAULT '[]',
  is_completed  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (roadmap_id, week_number),
  CHECK (date_end >= date_start)
);

CREATE INDEX IF NOT EXISTS weekly_tasks_roadmap_id_idx ON weekly_tasks(roadmap_id);
CREATE INDEX IF NOT EXISTS weekly_tasks_user_id_idx    ON weekly_tasks(user_id);

DROP TRIGGER IF EXISTS weekly_tasks_updated_at ON weekly_tasks;
CREATE TRIGGER weekly_tasks_updated_at
  BEFORE UPDATE ON weekly_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE weekly_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_tasks: owner all"
  ON weekly_tasks FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SECTION H: Daily Logs
-- ============================================================

-- One row per calendar date per career plan.
-- checklist_items shape: [{ id, text, is_completed }]
-- all_items_completed and is_archived are maintained by the application.
CREATE TABLE IF NOT EXISTS daily_logs (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  career_plan_id       UUID        NOT NULL REFERENCES career_plans(id) ON DELETE CASCADE,
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date             DATE        NOT NULL,
  summary              TEXT        NOT NULL DEFAULT '',
  checklist_items      JSONB       NOT NULL DEFAULT '[]',
  all_items_completed  BOOLEAN     NOT NULL DEFAULT FALSE,
  is_archived          BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (career_plan_id, log_date)
);

CREATE INDEX IF NOT EXISTS daily_logs_career_plan_id_idx       ON daily_logs(career_plan_id);
CREATE INDEX IF NOT EXISTS daily_logs_user_id_idx              ON daily_logs(user_id);
CREATE INDEX IF NOT EXISTS daily_logs_career_plan_date_idx     ON daily_logs(career_plan_id, log_date DESC);

DROP TRIGGER IF EXISTS daily_logs_updated_at ON daily_logs;
CREATE TRIGGER daily_logs_updated_at
  BEFORE UPDATE ON daily_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_logs: owner all"
  ON daily_logs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SECTION I: Chat Messages (7-day retention)
-- ============================================================

-- Stores per-career-plan chat history. Messages are immutable (no updated_at).
-- sequence_number: monotonically increasing per career_plan_id for stable pagination.
-- sources_json: ChatQnAOutput.sources (RAG provenance) for assistant messages.
-- follow_up_json: ChatQnAOutput.follow_up_suggestions for assistant messages.
CREATE TABLE IF NOT EXISTS chat_messages (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  career_plan_id   UUID        NOT NULL REFERENCES career_plans(id) ON DELETE CASCADE,
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role             TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT        NOT NULL,
  sequence_number  BIGINT      NOT NULL DEFAULT 0,
  sources_json     JSONB       NOT NULL DEFAULT '[]',
  follow_up_json   JSONB       NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_messages_career_plan_seq_idx
  ON chat_messages(career_plan_id, sequence_number ASC);
CREATE INDEX IF NOT EXISTS chat_messages_user_id_idx
  ON chat_messages(user_id);
-- Partial index for the common 7-day window query
CREATE INDEX IF NOT EXISTS chat_messages_recent_idx
  ON chat_messages(career_plan_id, created_at DESC)
  WHERE created_at > NOW() - INTERVAL '7 days';

-- View used by the app for chat history display — enforces 7-day retention window.
-- RLS on the base table also applies when querying through this view.
CREATE OR REPLACE VIEW recent_chat_messages AS
SELECT *
  FROM chat_messages
 WHERE created_at > NOW() - INTERVAL '7 days'
 ORDER BY career_plan_id, sequence_number ASC;

-- Hard-deletes messages older than 7 days.
-- Schedule via pg_cron: SELECT cron.schedule('cleanup-chat-daily','0 3 * * *',
--   $$SELECT cleanup_old_chat_messages()$$);
CREATE OR REPLACE FUNCTION cleanup_old_chat_messages()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM chat_messages
   WHERE created_at < NOW() - INTERVAL '7 days';

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Sets sequence_number = MAX(sequence_number)+1 per career_plan_id on INSERT.
-- Gaps are expected after cleanup; sequence_number is for ordering, not continuity.
CREATE OR REPLACE FUNCTION set_chat_sequence_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  next_seq BIGINT;
BEGIN
  SELECT COALESCE(MAX(sequence_number), 0) + 1
    INTO next_seq
    FROM chat_messages
   WHERE career_plan_id = NEW.career_plan_id;

  NEW.sequence_number = next_seq;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_messages_sequence ON chat_messages;
CREATE TRIGGER chat_messages_sequence
  BEFORE INSERT ON chat_messages
  FOR EACH ROW EXECUTE FUNCTION set_chat_sequence_number();

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_messages: owner all"
  ON chat_messages FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- SECTION J: JD Documents (pgvector — RAG knowledge base)
-- ============================================================

-- System/admin-owned table. No RLS.
-- Updated from the legacy schema in mcp-skills/career-knowledge-base/supabase/schema.sql:
--   embedding dimension: 1536 → 768 (gemini-embedding-001 output)
-- doc_id UNIQUE supports idempotent Google Drive re-sync upserts.
CREATE TABLE IF NOT EXISTS jd_documents (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  doc_id       TEXT        UNIQUE NOT NULL,
  doc_type     TEXT        NOT NULL DEFAULT 'reference'
                           CHECK (doc_type IN ('jd', 'reference')),
  title        TEXT,
  chunk_index  INTEGER     DEFAULT 0,
  text         TEXT        NOT NULL,
  metadata     JSONB       DEFAULT '{}',
  tags         TEXT[]      DEFAULT '{}',
  embedding    VECTOR(768),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- IVFFlat cosine index; tune `lists` after initial data load (sqrt of row count recommended)
CREATE INDEX IF NOT EXISTS jd_documents_embedding_idx
  ON jd_documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS jd_documents_doc_type_idx ON jd_documents(doc_type);
CREATE INDEX IF NOT EXISTS jd_documents_tags_idx     ON jd_documents USING gin(tags);

DROP TRIGGER IF EXISTS jd_documents_updated_at ON jd_documents;
CREATE TRIGGER jd_documents_updated_at
  BEFORE UPDATE ON jd_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RPC called by MCP career-knowledge-base → similaritySearch().
-- Updated signature: query_embedding VECTOR(768) (was 1536).
CREATE OR REPLACE FUNCTION match_jd_documents(
  query_embedding  VECTOR(768),
  match_count      INT     DEFAULT 5,
  filter_doc_type  TEXT    DEFAULT 'all',
  filter_tags      TEXT[]  DEFAULT NULL
)
RETURNS TABLE (
  doc_id       TEXT,
  doc_type     TEXT,
  title        TEXT,
  chunk_index  INTEGER,
  score        FLOAT,
  text         TEXT,
  metadata     JSONB
)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.doc_id,
    d.doc_type,
    d.title,
    d.chunk_index,
    (1 - (d.embedding <=> query_embedding))::FLOAT AS score,
    d.text,
    d.metadata
  FROM jd_documents d
  WHERE d.embedding IS NOT NULL
    AND (filter_doc_type = 'all' OR d.doc_type = filter_doc_type)
    AND (filter_tags IS NULL OR d.tags && filter_tags)
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- SECTION K: Optimized Resumes
-- ============================================================

-- One optimized resume per career plan (UNIQUE on career_plan_id).
-- resume_data: OptimizedResumeData shape (personal, highlights, skills, education, awards_and_certs, cover_letter).
-- markdown: full ATS-friendly Markdown output.
-- meta: { generated_at, language, keywords_applied }.
CREATE TABLE IF NOT EXISTS optimized_resumes (
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  career_plan_id  UUID        NOT NULL UNIQUE REFERENCES career_plans(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locale          VARCHAR(5)  NOT NULL DEFAULT 'en',
  resume_data     JSONB       NOT NULL DEFAULT '{}',
  markdown        TEXT        NOT NULL DEFAULT '',
  meta            JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS optimized_resumes_user_id_idx
  ON optimized_resumes(user_id);

DROP TRIGGER IF EXISTS optimized_resumes_updated_at ON optimized_resumes;
CREATE TRIGGER optimized_resumes_updated_at
  BEFORE UPDATE ON optimized_resumes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE optimized_resumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "optimized_resumes: owner all"
  ON optimized_resumes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "optimized_resumes: anon public read by id"
  ON optimized_resumes FOR SELECT
  TO anon
  USING (true);

-- ============================================================
-- SECTION L: pg_cron Setup (run after schema is applied)
-- ============================================================
-- Enable pg_cron via: Dashboard → Database → Extensions → pg_cron
-- Then register the daily cleanup job:
--
-- SELECT cron.schedule(
--   'cleanup-chat-messages-daily',
--   '0 3 * * *',
--   $$SELECT cleanup_old_chat_messages()$$
-- );
