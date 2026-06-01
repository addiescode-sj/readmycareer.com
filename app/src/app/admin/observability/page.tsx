import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAdminContext } from "@/lib/supabase/admin";
import { AGENT_RUN_SELECT, aggregateAgentRuns, type AgentRunRow } from "@/lib/observability";

// Live operational metrics — recomputed per request.
export const dynamic = "force-dynamic";

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function ms(v: number): string {
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <p className="text-label-sm uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 text-headline-md text-foreground">{value}</p>
    </div>
  );
}

export default async function ObservabilityPage() {
  const admin = await getAdminContext();
  // Gate on the admin role, not merely on being signed in. Non-admins (and anonymous
  // visitors) are redirected home rather than shown the operational dashboard.
  if (!admin?.isAdmin) redirect("/");

  const supabase = await createServerSupabaseClient();
  const t = await getTranslations("AdminObservability");

  const { data: rows } = await supabase
    .from("agent_runs")
    .select(AGENT_RUN_SELECT)
    .order("created_at", { ascending: false })
    .limit(1000);

  const safeRows = (rows ?? []) as AgentRunRow[];
  const stages = aggregateAgentRuns(safeRows);
  const totalRuns = safeRows.length;
  const totalCost = stages.reduce((s, st) => s + st.estCostUsd, 0);
  const totalCachedTokens = stages.reduce((s, st) => s + st.cachedTokens, 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-headline-lg text-foreground">{t("title")}</h1>
        <p className="mt-2 text-body-md text-muted-foreground">{t("subtitle")}</p>
      </header>

      {totalRuns === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-12 text-center">
          <p className="text-body-md text-muted-foreground">{t("noData")}</p>
        </div>
      ) : (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SummaryCard label={t("totalRuns")} value={String(totalRuns)} />
            <SummaryCard label={t("estCost")} value={`$${totalCost.toFixed(4)}`} />
            <SummaryCard
              label={t("cacheSavings")}
              value={`${totalCachedTokens.toLocaleString()} ${t("tokens")}`}
            />
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full text-left text-body-md">
              <thead className="border-b border-border text-label-sm uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{t("stage")}</th>
                  <th className="px-4 py-3">{t("count")}</th>
                  <th className="px-4 py-3">{t("failureRate")}</th>
                  <th className="px-4 py-3">{t("avgLatency")}</th>
                  <th className="px-4 py-3">{t("p95Latency")}</th>
                  <th className="px-4 py-3">{t("avgRetries")}</th>
                  <th className="px-4 py-3">{t("cacheHitRate")}</th>
                  <th className="px-4 py-3">{t("totalTokens")}</th>
                  <th className="px-4 py-3">{t("estCost")}</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr
                    key={s.stage}
                    className="border-b border-border/50 text-foreground last:border-0"
                  >
                    <td className="px-4 py-3 font-medium">{s.stage}</td>
                    <td className="px-4 py-3">{s.count}</td>
                    <td className="px-4 py-3">{pct(s.failureRate)}</td>
                    <td className="px-4 py-3">{ms(s.avgLatencyMs)}</td>
                    <td className="px-4 py-3">{ms(s.p95LatencyMs)}</td>
                    <td className="px-4 py-3">{s.avgRetries.toFixed(2)}</td>
                    <td className="px-4 py-3">{pct(s.cacheHitRate)}</td>
                    <td className="px-4 py-3">{s.totalTokens.toLocaleString()}</td>
                    <td className="px-4 py-3">${s.estCostUsd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-label-sm text-muted-foreground">
            {t("windowNote", { count: totalRuns })}
          </p>
        </>
      )}
    </div>
  );
}
