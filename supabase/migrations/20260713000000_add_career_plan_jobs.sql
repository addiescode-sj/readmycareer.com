-- ============================================================
-- Migration: add career_plan_jobs (durable checkpoint for /api/analyze)
--
-- /api/analyze runs a two-stage pipeline (gap analysis -> planning) over a
-- single SSE connection. If the client disconnects mid-run (network drop,
-- tab closed) the whole pipeline previously had to restart from scratch,
-- re-paying the gap-analysis LLM call. This table lets a reconnecting client
-- pass back a job id and skip straight to planning once gap analysis is
-- checkpointed.
--
-- Scope: client-reconnect resumability only. This does NOT make the
-- serverless function itself survive being killed mid-execution — only a
-- client that already received a jobId and retries can skip ahead.
--
-- Anonymous /api/analyze requests are not checkpointed (user_id is required)
-- — anonymous analysis simply keeps the existing full-restart-on-retry
-- behavior, unchanged.
-- ============================================================

CREATE TABLE IF NOT EXISTS career_plan_jobs (
  id                   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id              UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status               TEXT        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'gap_analysis_done', 'completed', 'error')),
  -- SHA-256 of the request inputs (resume/JD/role/company/duration/date/locale/provider) this job
  -- was computed for. A resume/replay is only honored when the current request hashes to the same
  -- value — otherwise a retry after editing the JD could splice stale results into a new request.
  input_fingerprint    TEXT,
  gap_analysis_result  JSONB,
  career_plan_result   JSONB,
  error_message        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS career_plan_jobs_user_id_idx ON career_plan_jobs(user_id);

DROP TRIGGER IF EXISTS career_plan_jobs_updated_at ON career_plan_jobs;
CREATE TRIGGER career_plan_jobs_updated_at
  BEFORE UPDATE ON career_plan_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE career_plan_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "career_plan_jobs: owner all"
  ON career_plan_jobs FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
