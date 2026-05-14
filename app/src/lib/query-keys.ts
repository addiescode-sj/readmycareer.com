// Shared query key factories — no "use client" so server components can import them too

export function careerPlansKey() {
  return ["careerPlans"] as const;
}

export function optimizedResumeKey(planId: string) {
  return ["optimizedResume", planId] as const;
}

export function chatMessagesKey(planId: string) {
  return ["chatMessages", planId] as const;
}
