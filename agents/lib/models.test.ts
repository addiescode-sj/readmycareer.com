// Smoke test for the model registry — also proves the ESM+TS jest config works
// (this module uses import.meta.url and a ".js" relative specifier).
import { GEMINI_MODEL, MODEL_PRICING } from "./models.js";

describe("model registry", () => {
  it("resolves a default Gemini model id", () => {
    expect(GEMINI_MODEL).toMatch(/^gemini-/);
  });

  it("prices every registered model with numeric input/output rates", () => {
    expect(Object.keys(MODEL_PRICING).length).toBeGreaterThan(0);
    for (const [id, p] of Object.entries(MODEL_PRICING)) {
      expect({ id, t: typeof p.input }).toEqual({ id, t: "number" });
      expect({ id, t: typeof p.output }).toEqual({ id, t: "number" });
    }
  });
});
