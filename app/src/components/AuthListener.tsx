"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function AuthListener() {
  useEffect(() => {
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        localStorage.setItem("rmc_has_logged_in", "true");
        localStorage.setItem("rmc_last_login_at", new Date().toISOString());
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return null;
}
