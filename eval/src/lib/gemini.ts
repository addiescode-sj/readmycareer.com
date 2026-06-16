// Thin wrapper over @google/generative-ai for the eval layer's two LLM needs:
//   - the LLM-as-judge (JSON-mode scoring) used by the agent harness, and
//   - free-text generation + embeddings used by the RAGAS RAG metrics.
//
// The eval harness is tooling, not the agent runtime, so — like the Python harness,
// which imported google.generativeai directly — it talks to the SDK here rather than
// going through agents/lib/model-adapter.ts (whose boundary rules govern agents/).

import { GoogleGenerativeAI } from "@google/generative-ai";
import { googleApiKey } from "./env";

/** LLM-as-judge model. Defaults to the project's standard model; override with EVAL_JUDGE_MODEL. */
export const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "gemini-3.1-flash-lite-preview";

/** RAGAS scoring model. Defaults to the project's standard model; override with EVAL_RAGAS_MODEL. */
export const RAGAS_LLM_MODEL = process.env.EVAL_RAGAS_MODEL ?? "gemini-3.1-flash-lite-preview";

/** Embedding model used by the RAG answer-relevancy metric. Override with EVAL_EMBED_MODEL. */
export const EMBED_MODEL = process.env.EVAL_EMBED_MODEL ?? "text-embedding-004";

/** Parses model JSON output, tolerating ```json fences the way a lenient json.loads would not. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Model output was not JSON: ${text.slice(0, 200)}`);
  }
}

export class GeminiClient {
  private readonly genai: GoogleGenerativeAI;

  constructor(apiKey?: string) {
    const key = apiKey ?? googleApiKey();
    if (!key) throw new Error("GOOGLE_API_KEY (or GEMINI_API_KEY) is not set.");
    this.genai = new GoogleGenerativeAI(key);
  }

  /** JSON-mode generation for the LLM judge (mirrors response_mime_type=application/json). */
  async generateJson(
    prompt: string,
    opts: { model?: string; maxOutputTokens?: number } = {}
  ): Promise<unknown> {
    const model = this.genai.getGenerativeModel({
      model: opts.model ?? JUDGE_MODEL,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: opts.maxOutputTokens ?? 256,
      },
    });
    const resp = await model.generateContent(prompt);
    return parseJsonLoose(resp.response.text());
  }

  /** Free-text generation for the RAG answer step (temperature 0 for determinism). */
  async generateText(prompt: string, opts: { model?: string } = {}): Promise<string> {
    const model = this.genai.getGenerativeModel({
      model: opts.model ?? RAGAS_LLM_MODEL,
      generationConfig: { temperature: 0 },
    });
    const resp = await model.generateContent(prompt);
    return resp.response.text();
  }

  /** Embeds a single string, returning the dense vector. */
  async embed(text: string, opts: { model?: string } = {}): Promise<number[]> {
    const model = this.genai.getGenerativeModel({ model: opts.model ?? EMBED_MODEL });
    const resp = await model.embedContent(text);
    return resp.embedding.values;
  }
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
