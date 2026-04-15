"use client";

import RoadmapView from "@/components/RoadmapView";
import { useSession } from "@/hooks/useSession";

export default function PlanSlot() {
  const { careerPlan, goToChat, toggleTodoDone } = useSession();

  if (!careerPlan) return null;

  return <RoadmapView plan={careerPlan} onStartChat={goToChat} onTodoToggle={toggleTodoDone} />;
}
