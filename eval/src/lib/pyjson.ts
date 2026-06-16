// Serialiser matching Python's `json.dumps(obj, ensure_ascii=False)` *default* output:
// items separated by ", " and key/value by ": " (with spaces), non-ASCII kept literally.
//
// This matters for parity: the cost estimate counts characters of the serialised request
// and response, and avg_cost_usd is a gated metric. JSON.stringify's compact separators
// would under-count and shift the cost, so the harness uses this for length-sensitive work.

export function pyJsonDumps(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return "[" + value.map(pyJsonDumps).join(", ") + "]";
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      // Python json.dumps skips nothing; undefined cannot appear from JSON.parse'd data.
      .map(([k, v]) => JSON.stringify(k) + ": " + pyJsonDumps(v));
    return "{" + parts.join(", ") + "}";
  }
  return "null";
}
