-- Store the parsed resume snapshot used to generate a career plan.
-- The resume optimizer reads this snapshot later, after the browser session is gone.
ALTER TABLE public.career_plans
  ADD COLUMN IF NOT EXISTS resume_json JSONB;
