// Per-1M-token USD prices, loaded from the single shared source config/model-pricing.json
// (the TS agent layer reads the same file via agents/lib/models.ts) so pricing lives in one
// place. Keyed by model id — the harness measures the default flash-lite Gemini path, so
// callers use that model's rates. Does not yet account for the Pro-tier pricing used by
// gap-analysis/resume-optimizer in production; a per-stage cost breakdown would need the
// harness to track which model id each stage actually used.
//
// This mirrors agent_harness.py's _load_model_pricing(): resolve config/model-pricing.json
// by walking up from this module, so it works regardless of the current working directory.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export interface ProviderPricing {
  input: number;
  output: number;
}

function loadModelPricing(): Record<string, ProviderPricing> {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    try {
      const raw = readFileSync(resolve(dir, "config", "model-pricing.json"), "utf8");
      return JSON.parse(raw) as Record<string, ProviderPricing>;
    } catch {
      const parent = resolve(dir, "..");
      if (parent === dir) break; // reached the filesystem root
      dir = parent;
    }
  }
  throw new Error("config/model-pricing.json not found (walked up from eval/src/lib).");
}

const PRICING = loadModelPricing();
const DEFAULT_MODEL_ID = "gemini-3.1-flash-lite-preview";

/** Per-1M-token USD input price for the Gemini product path. */
export const PRICE_INPUT_PER_1M = PRICING[DEFAULT_MODEL_ID].input;
/** Per-1M-token USD output price for the Gemini product path. */
export const PRICE_OUTPUT_PER_1M = PRICING[DEFAULT_MODEL_ID].output;
