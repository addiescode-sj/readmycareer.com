-- ============================================================
-- Migration: add optimized_resumes table
-- One optimized resume per career plan (UNIQUE on career_plan_id).
-- Enforced at DB level; the API layer also checks before generating.
-- ============================================================

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
