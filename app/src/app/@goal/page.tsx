"use client";

import GoalSetting from "@/components/GoalSetting";
import { useSession } from "@/hooks/useSession";

export default function GoalSlot() {
  const { resumeJson, setAnalysisResult } = useSession();

  // Do not render if resumeJson is absent (e.g., direct URL access)
  if (!resumeJson) return null;

  return <GoalSetting resumeJson={resumeJson} onAnalyzed={setAnalysisResult} />;
}
