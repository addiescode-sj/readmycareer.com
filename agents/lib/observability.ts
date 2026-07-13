// Structured, in-process observability for the agent layer.
//
// SSE progress events are for UX; this is the operational signal. For every agent stage we
// emit one structured JSON log line and update a rolling in-process aggregate so an /admin
// view can answer "what do latency / failure / retry / cache-hit / cost look like" without a
// DB round-trip. Durable persistence happens in the API route (agents never touch the DB):
// the orchestrator hands each metric to an onMetric callback that the route writes to Supabase.

import type { ModelProvider } from "./model-adapter.js";
import { FALLBACK_PRICING_BY_PROVIDER, MODEL_PRICING } from "./models.js";

export type AgentStage =
  | "gap_analysis"
  | "planning"
  | "chat_qna"
  | "resume_optimizer"
  | string;

export interface AgentRunMetric {
  runId: string;
  stage: AgentStage;
  provider: ModelProvider | string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheHit: boolean;
  retryCount: number;
  success: boolean;
  errorType?: string | null;
}

export function estimateCostUsd(
  model: string,
  provider: string,
  promptTokens: number,
  completionTokens: number
): number {
  // Rates come from the shared source config/model-pricing.json (via models.ts), keyed by
  // model id since different models on the same provider have different prices; the eval
  // harness reads the same file, so live /admin cost reconciles with offline eval by design.
  const rate = MODEL_PRICING[model] ?? FALLBACK_PRICING_BY_PROVIDER[provider as ModelProvider];
  return (promptTokens / 1e6) * rate.input + (completionTokens / 1e6) * rate.output;
}

// ── In-process aggregate ────────────────────────────────────────────────────

const MAX_RECENT = 200; // ring buffer of recent runs surfaced to /admin
const MAX_LATENCY_SAMPLES = 1000; // bounded sample window for p95

interface StageAgg {
  count: number;
  failures: number;
  sumLatencyMs: number;
  latencies: number[];
  sumRetries: number;
  cacheHits: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  estCostUsd: number;
}

function emptyAgg(): StageAgg {
  return {
    count: 0,
    failures: 0,
    sumLatencyMs: 0,
    latencies: [],
    sumRetries: 0,
    cacheHits: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    estCostUsd: 0,
  };
}

const stageAggs = new Map<string, StageAgg>();
const recentRuns: AgentRunMetric[] = [];

/** Emits one structured JSON log line for a completed agent run. */
export function logEvent(metric: AgentRunMetric): void {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), evt: "agent_run", ...metric }));
  } catch {
    // Never let logging break a request.
  }
}

/** Records a completed agent run: logs it and folds it into the in-process aggregate. */
export function recordAgentRun(metric: AgentRunMetric): void {
  logEvent(metric);

  const agg = stageAggs.get(metric.stage) ?? emptyAgg();
  agg.count += 1;
  if (!metric.success) agg.failures += 1;
  agg.sumLatencyMs += metric.latencyMs;
  agg.latencies.push(metric.latencyMs);
  if (agg.latencies.length > MAX_LATENCY_SAMPLES) agg.latencies.shift();
  agg.sumRetries += metric.retryCount;
  if (metric.cacheHit) agg.cacheHits += 1;
  agg.promptTokens += metric.promptTokens;
  agg.completionTokens += metric.completionTokens;
  agg.cachedTokens += metric.cachedTokens;
  agg.estCostUsd += estimateCostUsd(
    metric.model,
    metric.provider,
    metric.promptTokens,
    metric.completionTokens
  );
  stageAggs.set(metric.stage, agg);

  recentRuns.push(metric);
  if (recentRuns.length > MAX_RECENT) recentRuns.shift();
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export interface StageSnapshot {
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

export interface ObservabilitySnapshot {
  generatedAt: string;
  stages: StageSnapshot[];
  recent: AgentRunMetric[];
}

/** Returns the current in-process aggregate, per stage, plus the recent-run ring buffer. */
export function getObservabilitySnapshot(): ObservabilitySnapshot {
  const stages: StageSnapshot[] = [...stageAggs.entries()].map(([stage, a]) => ({
    stage,
    count: a.count,
    failureRate: a.count ? a.failures / a.count : 0,
    avgLatencyMs: a.count ? a.sumLatencyMs / a.count : 0,
    p95LatencyMs: percentile(a.latencies, 95),
    avgRetries: a.count ? a.sumRetries / a.count : 0,
    cacheHitRate: a.count ? a.cacheHits / a.count : 0,
    totalTokens: a.promptTokens + a.completionTokens,
    cachedTokens: a.cachedTokens,
    estCostUsd: a.estCostUsd,
  }));

  return {
    generatedAt: new Date().toISOString(),
    stages,
    recent: [...recentRuns].reverse(),
  };
}

/** Clears all in-process aggregates. Intended for tests. */
export function resetObservability(): void {
  stageAggs.clear();
  recentRuns.length = 0;
}
