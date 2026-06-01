-- ============================================================
-- Migration: add admin role to profiles
--
-- Adds an `is_admin` flag to profiles so the app can distinguish admin accounts
-- from regular members. Admin accounts are granted manually in the Supabase
-- dashboard (UPDATE profiles SET is_admin = true WHERE id = '<auth.users.id>').
--
-- A SECURITY DEFINER helper `public.is_admin()` resolves the current caller's
-- admin status while bypassing profiles RLS (avoids policy recursion). It is
-- used both by app code and by the agent_runs read policy below.
--
-- The /admin observability view previously allowed ANY authenticated user to
-- read agent_runs. This migration tightens that to admins only.
-- ============================================================

-- 1. Admin flag on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. SECURITY DEFINER helper: is the current user an admin?
--    Definer + pinned empty search_path is the secure form; table is schema-qualified.
--    Bypasses profiles RLS, so it is safe to call from within RLS policies.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    (SELECT p.is_admin FROM public.profiles p WHERE p.id = auth.uid()),
    FALSE
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- 3. Restrict agent_runs reads to admins (was: any authenticated user).
DROP POLICY IF EXISTS "agent_runs: authenticated read" ON public.agent_runs;

CREATE POLICY "agent_runs: admin read"
  ON public.agent_runs FOR SELECT
  USING (public.is_admin());
