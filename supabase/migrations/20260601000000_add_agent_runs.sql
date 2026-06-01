-- ============================================================
-- Migration: add agent_runs telemetry table
-- Per-stage observability for the agent pipeline: latency, token usage, cache hits,
-- retries, and success/failure. Powers the /admin observability view.
--
-- Rows carry NO PII (no resume/JD content) — only operational metrics. Because
-- /api/analyze also serves anonymous visitors, INSERT is intentionally permissive.
-- SELECT is restricted to authenticated users (the admin observability view).
-- Rows are immutable: no UPDATE/DELETE policy is granted, so those are denied by RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_runs (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  run_id            UUID        NOT NULL,
  user_id           UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  stage             VARCHAR(40) NOT NULL,
  provider          VARCHAR(20) NOT NULL,
  model             VARCHAR(80) NOT NULL,
  latency_ms        INTEGER     NOT NULL DEFAULT 0,
  prompt_tokens     INTEGER     NOT NULL DEFAULT 0,
  completion_tokens INTEGER     NOT NULL DEFAULT 0,
  cached_tokens     INTEGER     NOT NULL DEFAULT 0,
  cache_hit         BOOLEAN     NOT NULL DEFAULT FALSE,
  retry_count       INTEGER     NOT NULL DEFAULT 0,
  success           BOOLEAN     NOT NULL DEFAULT TRUE,
  error_type        VARCHAR(40),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agent_runs_run_id_idx     ON agent_runs(run_id);
CREATE INDEX IF NOT EXISTS agent_runs_created_at_idx ON agent_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_stage_idx      ON agent_runs(stage);

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;

-- Telemetry rows are non-sensitive operational metrics; allow inserts from any client
-- (including anonymous analyze requests).
CREATE POLICY "agent_runs: anyone insert"
  ON agent_runs FOR INSERT
  WITH CHECK (true);

-- Restrict reads to authenticated users (admin observability view).
CREATE POLICY "agent_runs: authenticated read"
  ON agent_runs FOR SELECT
  USING (auth.role() = 'authenticated');
