"use client";

import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useTranslations } from "next-intl";

interface Props {
  className?: string;
  showLabel?: boolean;
}

export function SignOutButton({ className, showLabel = true }: Props) {
  const t = useTranslations("Dashboard");
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
      title={!showLabel ? t("logout") : undefined}
      className={className || "px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors"}
    >
      <LogOut className="w-5 h-5 shrink-0" />
      {showLabel && <span className="whitespace-nowrap">{t("logout")}</span>}
    </button>
  );
}
