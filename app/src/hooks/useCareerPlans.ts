"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { careerPlansKey } from "@/lib/query-keys";

export { careerPlansKey };

export interface CareerPlanRow {
  id: string;
  title: string | null;
  target_role: string;
  target_company: string;
  status: "active" | "completed" | "archived";
  start_date: string | null;
  duration_weeks: number | null;
  created_at: string;
  gap_analyses: Array<{ summary_json: unknown }> | null;
  roadmaps: { summary: string | null; week_count: number | null; phases_json: unknown } | Array<{ summary: string | null; week_count: number | null; phases_json: unknown }> | null;
}

export function useCareerPlans() {
  const supabase = createClient();
  return useQuery({
    queryKey: careerPlansKey(),
    queryFn: async (): Promise<CareerPlanRow[]> => {
      const { data, error } = await supabase
        .from("career_plans")
        .select(
          "id, title, target_role, target_company, status, start_date, duration_weeks, created_at, gap_analyses(summary_json), roadmaps(summary, week_count, phases_json)"
        )
        .neq("status", "archived")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CareerPlanRow[];
    },
    staleTime: 60 * 1000,
  });
}

export function useDeleteCareerPlan() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase
        .from("career_plans")
        .delete()
        .eq("id", planId);
      if (error) throw error;
      return planId;
    },
    onSuccess: (planId) => {
      queryClient.setQueryData(careerPlansKey(), (old: CareerPlanRow[] | undefined) =>
        (old ?? []).filter((p) => p.id !== planId)
      );
    },
  });
}

export function useUpdateCareerPlanTitle() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ planId, title }: { planId: string; title: string }) => {
      const { error } = await supabase
        .from("career_plans")
        .update({ title })
        .eq("id", planId);
      if (error) throw error;
      return { planId, title };
    },
    onSuccess: ({ planId, title }) => {
      queryClient.setQueryData(careerPlansKey(), (old: CareerPlanRow[] | undefined) =>
        (old ?? []).map((p) => (p.id === planId ? { ...p, title } : p))
      );
    },
  });
}
