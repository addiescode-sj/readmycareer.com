"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Step = "upload" | "goal" | "plan";

interface SessionState {
  step: Step;
  resumeJson: Record<string, unknown> | null;
  careerPlan: Record<string, unknown> | null;
  gapAnalysis: Record<string, unknown> | null;
  targetRole: string | null;
  targetCompany: string | null;
  jdText: string | null;
  isChatOpen: boolean;
}

interface SessionContextValue extends SessionState {
  isLoaded: boolean;
  setResumeJson: (data: Record<string, unknown>) => void;
  setAnalysisResult: (
    careerPlan: Record<string, unknown>,
    gapAnalysis: Record<string, unknown>,
    targetRole: string,
    targetCompany: string,
    jdText: string
  ) => void;
  toggleTodoDone: (weekNumber: number, todoId: string, done: boolean) => void;
  goToChat: () => void;
  closeChat: () => void;
}

const STORAGE_KEY = "rmc_session";
const INITIAL: SessionState = {
  step: "upload",
  resumeJson: null,
  careerPlan: null,
  gapAnalysis: null,
  targetRole: null,
  targetCompany: null,
  jdText: null,
  isChatOpen: false,
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(INITIAL);
  const [isLoaded, setIsLoaded] = useState(false);

  // Restore from sessionStorage on mount
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("new") === "true") {
        sessionStorage.removeItem(STORAGE_KEY);
        setIsLoaded(true);
        return;
      }
    } catch {}

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        // Migrate sessions saved with "chat" step from previous versions
        if (parsed.step === "chat") {
          parsed.step = "plan";
          parsed.isChatOpen = true;
        }
        setState({ ...INITIAL, ...(parsed as Partial<SessionState>) });
      }
    } catch {
      // Ignore when sessionStorage is inaccessible
    }
    setIsLoaded(true);
  }, []);

  // Helper that handles setState and sessionStorage sync together
  const commit = useCallback(
    (updater: (prev: SessionState) => SessionState) => {
      setState((prev) => {
        const next = updater(prev);
        try {
          // resumeJson is kept in-memory only; never persisted to sessionStorage
          // Resume is managed server-side via career_plans.resume_json
          const { resumeJson: _resumeJson, ...toStore } = next;
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
        } catch {}
        return next;
      });
    },
    []
  );

  const setResumeJson = useCallback(
    (resumeJson: Record<string, unknown>) => {
      commit((prev) => ({ ...prev, resumeJson }));
    },
    [commit]
  );

  const setAnalysisResult = useCallback(
    (
      careerPlan: Record<string, unknown>,
      gapAnalysis: Record<string, unknown>,
      targetRole: string,
      targetCompany: string,
      jdText: string
    ) => {
      commit((prev) => ({
        ...prev,
        careerPlan,
        gapAnalysis,
        targetRole,
        targetCompany,
        jdText,
        step: "plan",
      }));
    },
    [commit]
  );

  const toggleTodoDone = useCallback(
    (weekNumber: number, todoId: string, done: boolean) => {
      commit((prev) => {
        if (!prev.careerPlan) return prev;
        const plan = prev.careerPlan as {
          weeks: { week_number: number; todos: { id: string; done: boolean }[] }[];
        };
        const updatedWeeks = plan.weeks.map((week) => {
          if (week.week_number !== weekNumber) return week;
          return {
            ...week,
            todos: week.todos.map((todo) =>
              todo.id === todoId ? { ...todo, done } : todo
            ),
          };
        });
        return {
          ...prev,
          careerPlan: { ...prev.careerPlan, weeks: updatedWeeks },
        };
      });
    },
    [commit]
  );

  const goToChat = useCallback(() => {
    commit((prev) => ({ ...prev, isChatOpen: true }));
  }, [commit]);

  const closeChat = useCallback(() => {
    commit((prev) => ({ ...prev, isChatOpen: false }));
  }, [commit]);

  return (
    <SessionContext.Provider
      value={{ ...state, isLoaded, setResumeJson, setAnalysisResult, toggleTodoDone, goToChat, closeChat }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}
