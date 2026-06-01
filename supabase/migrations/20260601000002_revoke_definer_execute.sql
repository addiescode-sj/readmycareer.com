-- ============================================================
-- Migration: revoke client EXECUTE on SECURITY DEFINER functions
--
-- handle_new_user fires only as a trigger on auth.users (trigger execution does not require
-- the invoking role to hold EXECUTE), and cleanup_old_chat_messages is a maintenance routine.
-- Neither is called from app code via PostgREST RPC. Revoking EXECUTE from PUBLIC/anon/
-- authenticated removes the RPC attack surface; service_role retains access for any
-- server-side maintenance, and pg_cron/postgres are unaffected.
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.handle_new_user()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_old_chat_messages() FROM PUBLIC, anon, authenticated;

-- Preserve a server-side maintenance path for the cleanup routine.
GRANT EXECUTE ON FUNCTION public.cleanup_old_chat_messages() TO service_role;
