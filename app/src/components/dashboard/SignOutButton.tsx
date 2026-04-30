"use client";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    localStorage.removeItem("rmc_has_logged_in");
    localStorage.removeItem("rmc_last_login_at");
    window.location.href = "/";
  }

  return (
    <button
      onClick={handleSignOut}
      className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"
    >
      로그아웃
    </button>
  );
}
