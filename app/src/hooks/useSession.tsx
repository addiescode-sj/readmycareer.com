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
          // Strip personal contact info from resumeJson before persisting to sessionStorage
          const { personal: _personal, ...resumeJsonSafe } =
            (next.resumeJson ?? {}) as Record<string, unknown> & { personal?: unknown };
          const toStore = {
            ...next,
            resumeJson: next.resumeJson ? resumeJsonSafe : null,
          };
          sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
        } catch {}
        return next;
      });
    },
    []
  );

  const setResumeJson = useCallback(
    (resumeJson: Record<string, unknown>) => {
      commit((prev) => ({ ...prev, resumeJson, step: "goal" }));
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
