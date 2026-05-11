"use client";

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import { SessionProvider, useSession } from "@/hooks/useSession";
import { createClient } from "@/lib/supabase/client";
import InitializeWorkspace from "@/components/InitializeWorkspace";
import RoadmapView from "@/components/RoadmapView";

type SaveStatus = "idle" | "saving" | "saved" | "error" | "limit_reached";

function GoogleIcon() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function PlanSaveHeader() {
  const t = useTranslations("RoadmapView");
  const { careerPlan, gapAnalysis, targetRole, targetCompany, jdText, resumeJson } = useSession();
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [oauthLoading, setOauthLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (sessionStorage.getItem("rmc_plan_saved") === "true") {
      setSaveStatus("saved");
    }

    supabase.auth.getUser().then(({ data }) => setIsLoggedIn(!!data.user));

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setIsLoggedIn(!!session?.user);

        const shouldSave = (event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user && careerPlan && jdText;
        if (shouldSave) {
          if (sessionStorage.getItem("rmc_plan_saved") === "true") return;
          setSaveStatus("saving");
          try {
            const res = await fetch("/api/career-plans", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                targetRole: targetRole ?? "",
                targetCompany: targetCompany ?? "",
                jdText,
                resumeJson: resumeJson ?? undefined,
                careerPlan,
                gapAnalysis: gapAnalysis ?? {},
              }),
            });
            if (res.ok) {
              sessionStorage.setItem("rmc_plan_saved", "true");
              setSaveStatus("saved");
            } else {
              const body = await res.json().catch(() => ({})) as Record<string, string>;
              setSaveStatus(body["error"] === "plan_limit_reached" ? "limit_reached" : "error");
            }
          } catch {
            setSaveStatus("error");
          }
        }
      }
    );
    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signInWithGoogle() {
    setOauthLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard` },
    });
  }

  if (saveStatus === "saving") {
    return (
      <div className="flex items-center gap-2">
        <div className="w-3.5 h-3.5 border-2 border-primary/40 border-t-primary rounded-full animate-spin" />
        <span className="text-sm text-muted-foreground">{t("saving")}</span>
      </div>
    );
  }

  if (saveStatus === "saved") {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-green-700">✓ {t("saved")}</span>
        <button
          onClick={() => { window.location.href = "/dashboard"; }}
          className="text-sm text-primary hover:underline font-medium"
        >
          {t("viewInDashboard")}
        </button>
      </div>
    );
  }

  if (saveStatus === "limit_reached") {
    return (
      <button
        onClick={() => { window.location.href = "/dashboard"; }}
        className="text-sm text-yellow-700 hover:underline font-medium"
      >
        {t("goToDashboard")}
      </button>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground hidden sm:inline">{t("loginToPersist")}</span>
        <button
          onClick={signInWithGoogle}
          disabled={oauthLoading}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-semibold rounded-xl hover:opacity-90 transition-all shadow-sm disabled:opacity-50 whitespace-nowrap"
        >
          {oauthLoading ? (
            <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
          ) : (
            <GoogleIcon />
          )}
          {t("saveWithGoogle")}
        </button>
      </div>
    );
  }

  // Logged in, plan save in progress or just confirmed — show dashboard link
  return (
    <button
      onClick={() => { window.location.href = "/dashboard"; }}
      className="text-sm text-primary hover:underline font-medium"
    >
      {t("viewInDashboard")}
    </button>
  );
}

function OnboardingFlowInner() {
  const t = useTranslations("SessionLayout");
  const { step, careerPlan, goToChat, toggleTodoDone, isLoaded } = useSession();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (step === "upload") {
    return <InitializeWorkspace />;
  }

  if (step === "plan" && careerPlan) {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        {/* Sticky header with save CTA */}
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-bold text-foreground">readmycareer.com</p>
              <p className="text-xs text-muted-foreground">{t("subtitle")}</p>
            </div>
            <PlanSaveHeader />
          </div>
        </header>

        <main className="flex-1 container mx-auto px-4 py-8">
          <div className="max-w-4xl mx-auto">
            <RoadmapView
              plan={careerPlan}
              onStartChat={goToChat}
              onTodoToggle={toggleTodoDone}
              hideSaveBanner={true}
              hideChat={true}
            />
          </div>
        </main>
      </div>
    );
  }

  return null;
}

export default function OnboardingFlow() {
  return (
    <SessionProvider>
      <OnboardingFlowInner />
    </SessionProvider>
  );
}
