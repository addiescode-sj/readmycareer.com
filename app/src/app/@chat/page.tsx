"use client";

import ChatInterface from "@/components/ChatInterface";
import { useSession } from "@/hooks/useSession";

export default function ChatSlot() {
  const { resumeJson, gapAnalysis, careerPlan, targetRole, targetCompany } = useSession();

  return (
    <ChatInterface
      resumeJson={resumeJson}
      gapAnalysis={gapAnalysis}
      careerPlan={careerPlan}
      targetRole={targetRole}
      targetCompany={targetCompany}
    />
  );
}
