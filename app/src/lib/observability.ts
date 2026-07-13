import { estimateCostUsd } from "@readmycareer/agents/observability";

// Shape of an agent_runs row selected for the observability view.
export interface AgentRunRow {
  stage: string;
  provider: string;
  model: string;
  latency_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  cache_hit: boolean;
  retry_count: number;
  success: boolean;
  created_at: string;
}

export interface StageAggregate {
  stage: string;
  count: number;
  failureRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  avgRetries: number;
  cacheHitRate: number;
  totalTokens: number;
  cachedTokens: number;
  estCostUsd: number;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Aggregates raw agent_runs rows into per-stage operational metrics for the /admin view. */
export function aggregateAgentRuns(rows: AgentRunRow[]): StageAggregate[] {
  const byStage = new Map<string, AgentRunRow[]>();
  for (const r of rows) {
    const arr = byStage.get(r.stage) ?? [];
    arr.push(r);
    byStage.set(r.stage, arr);
  }

  return Array.from(byStage.entries()).map(([stage, rs]) => {
    const count = rs.length;
    const latencies = rs.map((r) => r.latency_ms);
    const promptTokens = rs.reduce((s, r) => s + r.prompt_tokens, 0);
    const completionTokens = rs.reduce((s, r) => s + r.completion_tokens, 0);
    return {
      stage,
      count,
      failureRate: count ? rs.filter((r) => !r.success).length / count : 0,
      avgLatencyMs: count ? latencies.reduce((a, b) => a + b, 0) / count : 0,
      p95LatencyMs: percentile(latencies, 95),
      avgRetries: count ? rs.reduce((s, r) => s + r.retry_count, 0) / count : 0,
      cacheHitRate: count ? rs.filter((r) => r.cache_hit).length / count : 0,
      totalTokens: promptTokens + completionTokens,
      cachedTokens: rs.reduce((s, r) => s + r.cached_tokens, 0),
      estCostUsd: rs.reduce(
        (s, r) => s + estimateCostUsd(r.model, r.provider, r.prompt_tokens, r.completion_tokens),
        0
      ),
    };
  });
}

export const AGENT_RUN_SELECT =
  "stage, provider, model, latency_ms, prompt_tokens, completion_tokens, cached_tokens, cache_hit, retry_count, success, created_at";
