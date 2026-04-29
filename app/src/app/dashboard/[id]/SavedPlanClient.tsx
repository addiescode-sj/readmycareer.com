"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RoadmapView from "@/components/RoadmapView";
import ChatInterface from "@/components/ChatInterface";
import { createClient } from "@/lib/supabase/client";

export default function SavedPlanClient({ careerPlan, planId }: { careerPlan: any, planId: string }) {
  const router = useRouter();
  const [plan, setPlan] = useState(careerPlan);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const supabase = createClient();

  async function handleTodoToggle(weekNumber: number, todoId: string, done: boolean) {
    const updatedWeeks = plan.weeks.map((week: any) => {
      if (week.week_number !== weekNumber) return week;
      return {
        ...week,
        todos: week.todos.map((todo: any) =>
          todo.id === todoId ? { ...todo, done } : todo
        ),
      };
    });

    const newPlan = { ...plan, weeks: updatedWeeks };
    setPlan(newPlan);

    // Save to supabase roadmaps table (phases_json)
    const { error } = await supabase
      .from("roadmaps")
      .update({ phases_json: updatedWeeks })
      .eq("career_plan_id", planId);

    if (error) {
      console.error("Failed to update roadmap:", error);
      alert("진행도 저장에 실패했습니다. (DB 권한 확인 필요)");
    }
  }

  function handleStartChat() {
    setIsChatOpen(true);
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="container mx-auto max-w-4xl px-4">
        <Link href="/dashboard" className="inline-block mb-6 text-sm text-gray-500 hover:text-gray-900 transition-colors">
          ← 대시보드로 돌아가기
        </Link>
        <RoadmapView
          plan={plan}
          onStartChat={handleStartChat}
          onTodoToggle={handleTodoToggle}
          hideSaveBanner={true}
        />
      </div>

      {/* Floating Chat Panel */}
      <div
        className={`fixed bottom-6 right-6 w-96 bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col transition-all duration-300 ease-out z-50 ${
          isChatOpen
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-4 pointer-events-none"
        }`}
        style={{ height: "520px" }}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 rounded-t-2xl bg-white">
          <div className="flex items-center gap-2">
            <span className="text-lg">💬</span>
            <span className="text-sm font-semibold text-gray-900">AI 코치와 채팅</span>
          </div>
          <button
            onClick={() => setIsChatOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors text-lg leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* Chat body */}
        <div className="flex-1 overflow-hidden">
          <ChatInterface
            resumeJson={null}
            gapAnalysis={null}
            careerPlan={plan}
            targetRole={plan.target_jd_title}
            targetCompany={null}
            compact
            planId={planId}
          />
        </div>
      </div>

      {/* FAB button */}
      {!isChatOpen && (
        <button
          onClick={() => setIsChatOpen(true)}
          className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center justify-center text-2xl z-50"
          aria-label="채팅 열기"
        >
          💬
        </button>
      )}
    </div>
  );
}
