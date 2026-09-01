// Single source of truth for model identifiers and pricing.
//
// Every agent, the app API routes, and the MCP skills resolve their model from
// here — so a model bump (or a temporary override) happens in ONE place instead
// of being scattered as a string literal across the codebase. This is what makes
// the CLAUDE.md rule "do not silently switch models" enforceable: there is now a
// single switch point.
//
// Cross-process note: the MCP skills run as separate node processes and cannot
// import this module, so they read the same GEMINI_MODEL env var (forwarded by
// the pooled MCP client's buildEnv()). Setting GEMINI_MODEL once therefore flips
// the model for the in-process agents AND the spawned skills together.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { ModelProvider } from "./model-adapter.js";

/** Default Gemini model for all agents and MCP skills. Override with GEMINI_MODEL. */
export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite-preview";

/**
 * Higher-capability Gemini model for reasoning-heavy stages (gap analysis, resume
 * optimization). Override with GEMINI_MODEL_REASONING. Gemini Pro models are not
 * available on the free tier — gemini-2.5-flash is the strongest model reachable
 * without enabling billing; confirm this default still holds before relying on it.
 */
export const GEMINI_MODEL_REASONING = process.env.GEMINI_MODEL_REASONING ?? "gemini-2.5-flash";

/** Default OpenAI model for the swappable gap-analysis path. Override with OPENAI_MODEL. */
export const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-4o-mini";

export type ProviderPricing = { input: number; output: number };

/**
 * Loads per-1M-token USD prices from the single shared source, config/model-pricing.json,
 * which the eval harness reads too — so prices are maintained in exactly one file. Keyed
 * by model id (not provider) since different models on the same provider now have distinct
 * prices. Resolved by walking up from this module (works for src via tsx and compiled dist
 * alike). Falls back to baked-in values only if the file cannot be located (e.g. a bundled
 * build that did not trace it); those MUST mirror config/model-pricing.json.
 */
function loadModelPricing(): Record<string, ProviderPricing> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    try {
      const raw = readFileSync(resolve(dir, "config/model-pricing.json"), "utf8");
      // Drop "_"-prefixed doc keys (e.g. _comment) so callers can iterate the map safely.
      return Object.fromEntries(
        Object.entries(JSON.parse(raw) as Record<string, ProviderPricing>).filter(
          ([k]) => !k.startsWith("_")
        )
      );
    } catch {
      const parent = resolve(dir, "..");
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
  }
  console.warn(
    "[models] config/model-pricing.json not found — using baked-in fallback prices. " +
      "Keep these in sync with config/model-pricing.json."
  );
  return {
    "gemini-3.1-flash-lite-preview": { input: 0.075, output: 0.3 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
  };
}

/** Per-1M-token USD list prices, keyed by model id (single source: config/model-pricing.json). */
export const MODEL_PRICING: Record<string, ProviderPricing> = loadModelPricing();

/** Fallback pricing per provider, used when a specific model id has no pricing entry. */
export const FALLBACK_PRICING_BY_PROVIDER: Record<ModelProvider, ProviderPricing> = {
  gemini: MODEL_PRICING[GEMINI_MODEL] ?? { input: 0.075, output: 0.3 },
  openai: MODEL_PRICING[OPENAI_MODEL] ?? { input: 0.15, output: 0.6 },
};
