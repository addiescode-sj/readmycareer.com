// Provider-agnostic LLM adapter interface.
//
// The orchestrator talks to LLMs exclusively through this interface so a provider
// (Gemini, OpenAI, …) can be swapped without touching agent logic, prompts, or the
// quality-gate loop. Each adapter is responsible only for the raw generate call and
// (optionally) provider-specific context caching; telemetry is recorded at the
// orchestrator boundary, keeping adapters pure.

export type ModelProvider = "gemini" | "openai";

export interface GenerateOptions {
  systemInstruction: string;
  userPrompt: string;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  // Provider-specific cached-content handle (e.g. a Gemini context cache name).
  // Ignored by providers that do not support caching.
  cachedContentName?: string | null;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  // Tokens served from the provider cache (billed cheaper / not at all). 0 when no cache hit.
  cachedTokens: number;
}

export interface LlmResult {
  // null signals a failed call after the adapter's own retries are exhausted.
  text: string | null;
  usage: LlmUsage;
}

export interface CacheOptions {
  systemInstruction: string;
  resumeJson: unknown;
}

export interface ModelAdapter {
  readonly provider: ModelProvider;
  readonly model: string;
  readonly supportsContextCache: boolean;
  generateContent(opts: GenerateOptions): Promise<LlmResult>;
  // Returns a provider cache handle, or null when caching is unsupported or creation failed.
  getOrCreateCache?(opts: CacheOptions): Promise<string | null>;
}

export const ZERO_USAGE: LlmUsage = {
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
};

/**
 * Builds the adapter for a provider. Adapters are dynamically imported so the unused
 * provider SDK is never loaded (e.g. a Gemini-only run never imports the OpenAI SDK),
 * and so a missing optional dependency cannot break the default path.
 *
 * Provider resolution: explicit arg → MODEL_PROVIDER env → "gemini".
 */
export async function getModelAdapter(
  provider?: ModelProvider,
  apiKey?: string
): Promise<ModelAdapter> {
  const resolved =
    provider ?? (process.env.MODEL_PROVIDER as ModelProvider | undefined) ?? "gemini";

  if (resolved === "openai") {
    const { OpenAIAdapter } = await import("./adapters/openai-adapter.js");
    return new OpenAIAdapter(apiKey);
  }

  const { GeminiAdapter } = await import("./adapters/gemini-adapter.js");
  return new GeminiAdapter(apiKey);
}
