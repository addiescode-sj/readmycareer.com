"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import RoadmapView from "@/components/RoadmapView";
import { useSession } from "@/hooks/useSession";
import { createClient } from "@/lib/supabase/client";

export default function PlanSlot() {
  const t = useTranslations("RoadmapView");
  const { careerPlan, goToChat, toggleTodoDone } = useSession();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setIsLoggedIn(!!data.user);
    });
  }, []);

  if (!careerPlan) return null;

  return (
    <div>
      {isLoggedIn && (
        <Link
          href="/dashboard"
          className="inline-block mb-6 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          ← {t("backToDashboard")}
        </Link>
      )}
      <RoadmapView plan={careerPlan} onStartChat={goToChat} onTodoToggle={toggleTodoDone} />
    </div>
  );
}

