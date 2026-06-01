import { NextResponse } from "next/server";
import { getObservabilitySnapshot } from "@readmycareer/agents/observability";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/supabase/admin";
import { AGENT_RUN_SELECT, aggregateAgentRuns, type AgentRunRow } from "@/lib/observability";

// GET /api/admin/observability
// Returns the live in-process aggregate (no DB round-trip) plus the durable aggregate from
// agent_runs. Restricted to admin accounts.
export async function GET() {
  const admin = await getAdminContext();
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!admin.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = await createServerSupabaseClient();
  const inMemory = getObservabilitySnapshot();

  const { data: rows } = await supabase
    .from("agent_runs")
    .select(AGENT_RUN_SELECT)
    .order("created_at", { ascending: false })
    .limit(1000);

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    inMemory,
    persisted: {
      sampleSize: (rows ?? []).length,
      stages: aggregateAgentRuns((rows ?? []) as AgentRunRow[]),
    },
  });
}
