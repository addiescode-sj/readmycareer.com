"use client";

import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { SessionProvider, useSession } from "@/hooks/useSession";
import FloatingChat from "@/components/FloatingChat";
import { createClient } from "@/lib/supabase/client";

interface SlotProps {
  upload: ReactNode;
  goal: ReactNode;
  plan: ReactNode;
  chat: ReactNode;
}

function StepRouter({ upload, goal, plan }: Omit<SlotProps, "chat">) {
  const { step, isLoaded } = useSession();
  const t = useTranslations("SessionLayout");

  const STEPS = [
    { key: "upload", label: t("steps.upload") },
    { key: "goal",   label: t("steps.goal") },
    { key: "plan",   label: t("steps.plan") },
  ] as const;

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <>
      {/* Step indicator */}
      <div className="flex gap-2 mb-8">
        {STEPS.map(({ key, label }, i) => (
          <div
            key={key}
            className={`flex items-center gap-2 text-sm ${step === key ? "text-blue-600 font-semibold" : "text-gray-400"
              }`}
          >
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${step === key
                  ? "border-blue-600 bg-blue-600 text-white"
                  : i < stepIndex
                    ? "border-blue-300 bg-blue-100 text-blue-400"
                    : "border-gray-300 text-gray-400"
                }`}
            >
              {i + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
            {i < 2 && <span className="text-gray-300 mx-1">›</span>}
          </div>
        ))}
      </div>

      {/* Render only the current step */}
      {step === "upload" && upload}
      {step === "goal" && goal}
      {step === "plan" && plan}

      {/* Floating chat on the career plan step */}
      {step === "plan" && <FloatingChat />}
    </>
  );
}

type GateStatus = "checking" | "show_welcome_back" | "idle";

function WelcomeBackOverlay({
  lastLoginAt,
  onDismiss,
  isLoggedIn,
}: {
  lastLoginAt: string | null;
  onDismiss: () => void;
  isLoggedIn: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  const formattedDate = lastLoginAt
    ? new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(lastLoginAt))
    : null;

  async function handleLoginClick() {
    setLoading(true);
    if (isLoggedIn) {
      window.location.href = "/dashboard";
      // Add a timeout to reset loading in case navigation fails
      setTimeout(() => setLoading(false), 3000);
    } else {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/api/auth/callback?next=/dashboard`,
        },
      });
      
      if (error) {
        console.error("OAuth error:", error);
        alert(`로그인 중 오류가 발생했습니다: ${error.message}`);
        setLoading(false);
      }
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-8 py-10 max-w-sm w-full">
        <h2 className="text-xl font-bold text-gray-900 mb-2">로그인 하시겠습니까?</h2>
        {formattedDate && (
          <p className="text-sm text-gray-500 mb-6">
            최근 로그인: {formattedDate}
          </p>
        )}

        <button
          onClick={handleLoginClick}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-gray-300 rounded-lg shadow-sm hover:shadow-md hover:bg-gray-50 transition-all text-gray-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed mb-4"
        >
          {loading ? (
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
          ) : isLoggedIn ? (
            <span className="font-semibold text-blue-600">대시보드로 이동</span>
          ) : (
            <>
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              <span>Google로 로그인</span>
            </>
          )}
        </button>

        <button
          onClick={onDismiss}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          로그인 없이 계속하기
        </button>
      </div>
    </div>
  );
}

function ReturningUserGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<GateStatus>("checking");
  const [lastLoginAt, setLastLoginAt] = useState<string | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const isNew = searchParams.get("new") === "true";
    if (isNew) {
      setStatus("idle");
      return;
    }

    const hasLoggedIn = localStorage.getItem("rmc_has_logged_in") === "true";
    if (!hasLoggedIn) {
      setStatus("idle");
      return;
    }

    supabase.auth.getUser().then(({ data }) => {
      setLastLoginAt(localStorage.getItem("rmc_last_login_at"));
      if (data.user) {
        setIsLoggedIn(true);
      }
      setStatus("show_welcome_back");
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "checking") {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "show_welcome_back") {
    return (
      <WelcomeBackOverlay
        lastLoginAt={lastLoginAt}
        isLoggedIn={isLoggedIn}
        onDismiss={() => setStatus("idle")}
      />
    );
  }

  return <>{children}</>;
}

export function SessionLayout({ upload, goal, plan, chat }: SlotProps) {
  const t = useTranslations("SessionLayout");

  return (
    <main className="container mx-auto max-w-4xl px-4 py-8">
      <SessionProvider>
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{t("title")}</h1>
          <p className="mt-1 text-gray-500">{t("subtitle")}</p>
        </div>
        <ReturningUserGate>
          <StepRouter upload={upload} goal={goal} plan={plan} />
        </ReturningUserGate>
      </SessionProvider>
    </main>
  );
}
