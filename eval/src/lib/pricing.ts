// Per-1M-token USD prices, loaded from the single shared source config/model-pricing.json
// (the TS agent layer reads the same file via agents/lib/models.ts) so pricing lives in one
// place. The harness measures the Gemini product path, so callers use the "gemini" rates.
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

/** Per-1M-token USD input price for the Gemini product path. */
export const PRICE_INPUT_PER_1M = PRICING.gemini.input;
/** Per-1M-token USD output price for the Gemini product path. */
export const PRICE_OUTPUT_PER_1M = PRICING.gemini.output;
