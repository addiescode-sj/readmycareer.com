-- ============================================================
-- Migration: security hardening (Supabase advisor remediations)
--
-- 1. Enable RLS on jd_documents. This is the legacy pgvector table; the app's RAG runs on
--    Pinecone and nothing in app/ or mcp-skills/ reads or writes it. No client policies are
--    added (access is service_role-only); add SELECT/INSERT policies if the pgvector path is
--    ever revived.
-- 2. Make recent_chat_messages a security_invoker view so it enforces the querying user's RLS
--    on chat_messages. As a SECURITY DEFINER view it bypassed per-user RLS, exposing every
--    user's recent messages to any authenticated caller. chat_messages already has an
--    owner policy (auth.uid() = user_id), so the per-user UI keeps working.
-- 3. Pin search_path on the flagged functions to close the mutable-search_path vector.
--    SECURITY DEFINER functions are schema-qualified and pinned to an empty search_path;
--    the rest are pinned to `public` (the only schema their bodies reference; pg_catalog is
--    always searched implicitly).
-- ============================================================

-- 1. jd_documents RLS (locked down; unused by the app)
ALTER TABLE public.jd_documents ENABLE ROW LEVEL SECURITY;

-- 2. recent_chat_messages → security_invoker
ALTER VIEW public.recent_chat_messages SET (security_invoker = on);

-- 3. Function search_path pinning
--    set_updated_at / handle_new_user reference only pg_catalog built-ins or already
--    schema-qualified objects, so an empty search_path is safe and strongest.
ALTER FUNCTION public.set_updated_at() SET search_path = '';
ALTER FUNCTION public.handle_new_user() SET search_path = '';

--    Non-definer trigger/query functions reference public tables unqualified → pin to public.
ALTER FUNCTION public.enforce_career_plan_limit() SET search_path = public;
ALTER FUNCTION public.set_chat_sequence_number() SET search_path = public;
ALTER FUNCTION public.match_jd_documents(vector, integer, text, text[]) SET search_path = public;

--    cleanup_old_chat_messages is SECURITY DEFINER: schema-qualify the table reference and
--    pin to an empty search_path (the secure form for a definer function).
CREATE OR REPLACE FUNCTION public.cleanup_old_chat_messages()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.chat_messages WHERE created_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$function$;
