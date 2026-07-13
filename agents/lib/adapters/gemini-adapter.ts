// Gemini implementation of ModelAdapter.
//
// This wraps the original orchestrator `callGemini` + `getOrCreateResumeCache` logic
// verbatim (API retries, wall-clock timeout, context-cache registry, TTL) so behavior is
// unchanged — only the call site moves behind the adapter interface.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAICacheManager } from "@google/generative-ai/server";
import { createHash } from "crypto";
import type {
  CacheOptions,
  GenerateOptions,
  LlmResult,
  ModelAdapter,
  ModelProvider,
} from "../model-adapter.js";
import { GEMINI_MODEL } from "../models.js";

/** Max retry attempts for API 429/5xx errors. */
const MAX_API_RETRIES = 3;

/** Overall wall-clock timeout per generateContent call (ms). Guards against hung connections. */
const GEMINI_CALL_TIMEOUT_MS = 45_000;

/** Context cache TTL in seconds. Reuses the cache for re-analysis of the same resume. */
const CACHE_TTL_SECONDS = 3600; // 1 hour

/** Silently ignore cache creation failures (e.g. insufficient token count) and proceed without caching. */
const CACHE_FALLBACK_ON_ERROR = true;

// ── Context cache registry ──────────────────────────────────────────────────
// Key: SHA-256(systemInstruction + resumeJson). Value: { cacheName, expiresAt }.
// Module-level singleton: persists across calls within the process, avoiding re-billing
// input tokens when the same resume is re-analyzed.
const cacheRegistry = new Map<string, { cacheName: string; expiresAt: number }>();
// In-flight creations (deduplicates concurrent createCache calls for the same key).
const inFlightCacheCreations = new Map<string, Promise<string | null>>();

// Includes the model id: a Gemini context cache is bound to the model it was created with,
// so caches for different model tiers (e.g. flash-lite vs pro) must not collide/be reused.
function hashResume(model: string, systemInstruction: string, resumeJson: unknown): string {
  return createHash("sha256")
    .update(model + systemInstruction + JSON.stringify(resumeJson))
    .digest("hex")
    .slice(0, 32);
}

function exponentialDelay(attempt: number, baseMs = 2000, maxMs = 60_000): number {
  // 2^attempt * baseMs + jitter (0~1000ms)
  return Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 1000, maxMs);
}

// Guards against hung connections that would otherwise block the SSE stream until the client disconnects.
function withTimeout<T>(op: Promise<T>): Promise<T> {
  return Promise.race([
    op,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Gemini call exceeded ${GEMINI_CALL_TIMEOUT_MS}ms`)),
        GEMINI_CALL_TIMEOUT_MS
      )
    ),
  ]);
}

export class GeminiAdapter implements ModelAdapter {
  readonly provider: ModelProvider = "gemini";
  readonly model: string;
  readonly supportsContextCache = true;
  private readonly apiKey: string;

  constructor(apiKey?: string, model: string = GEMINI_MODEL) {
    const key = apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set.");
    this.apiKey = key;
    this.model = model;
  }

  async getOrCreateCache(opts: CacheOptions): Promise<string | null> {
    const { systemInstruction, resumeJson } = opts;
    const key = hashResume(this.model, systemInstruction, resumeJson);

    // Deduplicate concurrent creations for the same key — without this, the two parallel
    // cache warm-ups in runCareerAnalysis would both create caches.
    const inFlight = inFlightCacheCreations.get(key);
    if (inFlight) return inFlight;

    const now = Date.now();
    const cached = cacheRegistry.get(key);
    if (cached && cached.expiresAt > now) {
      console.log("[CACHE] Resume cache HIT →", cached.cacheName);
      return cached.cacheName;
    }

    const creation = (async () => {
      try {
        const cacheManager = new GoogleAICacheManager(this.apiKey);
        const cache = await cacheManager.create({
          model: this.model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `[Resume data — use this for analysis]\n${JSON.stringify(resumeJson, null, 2)}`,
                },
              ],
            },
            {
              role: "model",
              parts: [{ text: "Resume data confirmed. Ready to begin analysis." }],
            },
          ],
          systemInstruction,
          ttlSeconds: CACHE_TTL_SECONDS,
          displayName: `resume-${key.slice(0, 8)}`,
        });

        cacheRegistry.set(key, {
          cacheName: cache.name!,
          expiresAt: now + (CACHE_TTL_SECONDS - 60) * 1000, // 60-second buffer
        });

        console.log("[CACHE] Resume cache created →", cache.name);
        return cache.name || null;
      } catch (err: any) {
        if (CACHE_FALLBACK_ON_ERROR) {
          console.warn(
            "[CACHE] Cache creation failed (proceeding without cache):",
            err?.message ?? err
          );
          return null;
        }
        throw err;
      }
    })();

    inFlightCacheCreations.set(key, creation);
    try {
      return await creation;
    } finally {
      inFlightCacheCreations.delete(key);
    }
  }

  async generateContent(opts: GenerateOptions): Promise<LlmResult> {
    const {
      systemInstruction,
      userPrompt,
      cachedContentName,
      maxOutputTokens = 8192,
      // Low temperature: prevents the model from dropping confirmed skill matches.
      // topP 0.85: retains semantic flexibility for abbreviation/synonym matching.
      temperature = 0.2,
      topP = 0.85,
      onToken,
    } = opts;
    const genai = new GoogleGenerativeAI(this.apiKey);

    for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
      try {
        const generationConfig = {
          responseMimeType: "application/json",
          maxOutputTokens,
          temperature,
          topP,
          // ponytail: disable thinking for JSON extraction stages; thinking tokens add
          // 20-60s latency on gemini-2.5-flash with no benefit when the output is structured JSON.
          thinkingConfig: { thinkingBudget: 0 },
        } as any;

        const modelInstance = cachedContentName
          ? genai.getGenerativeModel({ model: this.model })
          : genai.getGenerativeModel({ model: this.model, systemInstruction });

        const requestContents = [{ role: "user" as const, parts: [{ text: userPrompt }] }];
        const requestConfig = cachedContentName
          ? { contents: requestContents, cachedContent: cachedContentName, generationConfig } as any
          : { contents: requestContents, generationConfig };

        if (onToken) {
          // Streaming path: forward partial tokens to caller, accumulate for final return.
          return await withTimeout((async (): Promise<LlmResult> => {
            const streamResult = await modelInstance.generateContentStream(requestConfig);
            let fullText = "";
            for await (const chunk of streamResult.stream) {
              const chunkText = chunk.text();
              if (chunkText) {
                fullText += chunkText;
                onToken(chunkText);
              }
            }
            const response = await streamResult.response;
            const usage = response.usageMetadata;
            if (usage) {
              console.log(
                `[GEMINI] Token usage: input=${usage.promptTokenCount}, output=${usage.candidatesTokenCount}, cache=${usage.cachedContentTokenCount ?? 0}`
              );
            }
            return {
              text: fullText || null,
              usage: {
                promptTokens: usage?.promptTokenCount ?? 0,
                completionTokens: usage?.candidatesTokenCount ?? 0,
                cachedTokens: usage?.cachedContentTokenCount ?? 0,
              },
            };
          })());
        }

        // Non-streaming path (no onToken): collect full response in one shot.
        const result: any = await withTimeout(modelInstance.generateContent(requestConfig));

        const text = result.response.text();
        const usage = result.response.usageMetadata;
        if (usage) {
          console.log(
            `[GEMINI] Token usage: input=${usage.promptTokenCount}, output=${usage.candidatesTokenCount}, cache=${usage.cachedContentTokenCount ?? 0}`
          );
        }
        return {
          text,
          usage: {
            promptTokens: usage?.promptTokenCount ?? 0,
            completionTokens: usage?.candidatesTokenCount ?? 0,
            cachedTokens: usage?.cachedContentTokenCount ?? 0,
          },
        };
      } catch (err: any) {
        const status: number = err?.status ?? err?.statusCode ?? 0;
        const isRetryable = status === 429 || status >= 500;

        if (isRetryable && attempt < MAX_API_RETRIES - 1) {
          const delay = exponentialDelay(attempt);
          console.warn(
            `[GEMINI] HTTP ${status} — retrying in ${Math.round(delay / 1000)}s (${attempt + 1}/${MAX_API_RETRIES - 1})`
          );
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        console.error("[GEMINI] Call failed:", err?.message ?? err);
        return { text: null, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 } };
      }
    }
    return { text: null, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 } };
  }
}
