import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "./server";

// Resolves the current authenticated user and whether they hold the admin role.
// Admin status is the `is_admin` flag on the user's profile row (granted manually
// in Supabase). Returns null when there is no active session.
export async function getAdminContext(): Promise<{ user: User; isAdmin: boolean } | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  return { user, isAdmin: data?.is_admin === true };
}
