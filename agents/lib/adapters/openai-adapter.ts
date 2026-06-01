// OpenAI implementation of ModelAdapter.
//
// Demonstrates the provider abstraction: the same gap-analysis prompt + system instruction
// run on OpenAI with no change to agent logic. OpenAI has no equivalent of Gemini's explicit
// context-cache handle here, so supportsContextCache is false and the orchestrator inlines the
// resume into the prompt (the same branch used when a Gemini cache is unavailable).

import OpenAI from "openai";
import type {
  GenerateOptions,
  LlmResult,
  ModelAdapter,
  ModelProvider,
} from "../model-adapter.js";
import { OPENAI_MODEL } from "../models.js";

/** Max retry attempts for API 429/5xx errors (mirrors the Gemini adapter). */
const MAX_API_RETRIES = 3;

function backoffDelay(attempt: number, baseMs = 2000, maxMs = 60_000): number {
  return Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 1000, maxMs);
}

export class OpenAIAdapter implements ModelAdapter {
  readonly provider: ModelProvider = "openai";
  readonly model: string;
  readonly supportsContextCache = false;
  private readonly client: OpenAI;

  constructor(apiKey?: string) {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OPENAI_API_KEY is not set — required for provider=openai.");
    }
    this.model = OPENAI_MODEL;
    this.client = new OpenAI({ apiKey: key });
  }

  async generateContent(opts: GenerateOptions): Promise<LlmResult> {
    const {
      systemInstruction,
      userPrompt,
      maxOutputTokens = 8192,
      temperature = 0.2,
      topP = 0.85,
    } = opts;

    for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
      try {
        const completion = await this.client.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: userPrompt },
          ],
          // JSON-object mode mirrors Gemini's responseMimeType: "application/json".
          response_format: { type: "json_object" },
          max_tokens: maxOutputTokens,
          temperature,
          top_p: topP,
        });

        const text = completion.choices[0]?.message?.content ?? null;
        const usage = completion.usage;
        return {
          text,
          usage: {
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? 0,
            // Newer models report cached prompt tokens here; default to 0 when absent.
            cachedTokens:
              (usage as any)?.prompt_tokens_details?.cached_tokens ?? 0,
          },
        };
      } catch (err: any) {
        const status: number = err?.status ?? err?.statusCode ?? 0;
        const isRetryable = status === 429 || status >= 500;
        if (isRetryable && attempt < MAX_API_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, backoffDelay(attempt)));
          continue;
        }
        console.error("[OPENAI] Call failed:", err?.message ?? err);
        return { text: null, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 } };
      }
    }
    return { text: null, usage: { promptTokens: 0, completionTokens: 0, cachedTokens: 0 } };
  }
}
