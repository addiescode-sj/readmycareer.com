// Minimal reimplementation of the subset of Python `tabulate` the harness uses:
// the "simple" (console) and "github" (Markdown) table formats. It reproduces the
// three tabulate behaviours that affect visible output:
//
//   1. East-Asian-width-aware column sizing (Korean labels count as width 2), so
//      padding lines up the same way tabulate's does.
//   2. Numeric columns (every body cell parses as a number) are right-aligned.
//   3. Float cells in a numeric column are re-rendered with `%g` (default floatfmt),
//      which strips trailing zeros — e.g. "0.70" → "0.7", "0.00" → "0". This is why
//      the committed report shows "0.7", not the "0.70" the format string produced.
//
// Cell padding whitespace does not affect how Markdown renders the table; the values,
// column order, alignment, and headers match tabulate's output.

export type TableFormat = "simple" | "github";

/** Display width with East-Asian wide characters counted as 2 (mirrors wcwidth). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}

function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK Radicals .. Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana .. CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul Syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK Compatibility Ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK Compatibility Forms
    (cp >= 0xff00 && cp <= 0xff60) || // Fullwidth Forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji / pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK Ext B+
  );
}

const NUMERIC_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

function isNumeric(s: string): boolean {
  return s !== "" && NUMERIC_RE.test(s);
}

/** Python-style `%g` (default precision 6): trims insignificant trailing zeros. */
function formatG(s: string): string {
  if (!s.includes(".") && !/[eE]/.test(s)) return s; // integer — tabulate leaves it
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return String(parseFloat(n.toPrecision(6)));
}

interface Column {
  numeric: boolean;
  width: number;
  cells: string[]; // body cells, post numeric reformatting
}

function buildColumns(headers: string[], rows: string[][]): Column[] {
  return headers.map((header, c) => {
    const raw = rows.map((r) => r[c] ?? "");
    const numeric = raw.length > 0 && raw.every((v) => v === "" || isNumeric(v));
    const cells = numeric ? raw.map((v) => (v === "" ? "" : formatG(v))) : raw;
    const width = Math.max(displayWidth(header), ...cells.map(displayWidth), 0);
    return { numeric, width, cells };
  });
}

function pad(value: string, width: number, right: boolean): string {
  const fill = width - displayWidth(value);
  if (fill <= 0) return value;
  const spaces = " ".repeat(fill);
  return right ? spaces + value : value + spaces;
}

export function tabulate(
  headers: string[],
  rows: string[][],
  format: TableFormat
): string {
  const cols = buildColumns(headers, rows);

  if (format === "github") {
    const headerLine =
      "| " + cols.map((col, c) => pad(headers[c], col.width, false)).join(" | ") + " |";
    const sepLine = "|" + cols.map((col) => "-".repeat(col.width + 2)).join("|") + "|";
    const bodyLines = rows.map(
      (_, r) =>
        "| " +
        cols.map((col) => pad(col.cells[r] ?? "", col.width, col.numeric)).join(" | ") +
        " |"
    );
    return [headerLine, sepLine, ...bodyLines].join("\n");
  }

  // "simple": header, dashed rule, body — columns separated by two spaces.
  const headerLine = cols.map((col, c) => pad(headers[c], col.width, col.numeric)).join("  ");
  const sepLine = cols.map((col) => "-".repeat(col.width)).join("  ");
  const bodyLines = rows.map((_, r) =>
    cols.map((col) => pad(col.cells[r] ?? "", col.width, col.numeric)).join("  ")
  );
  return [headerLine, sepLine, ...bodyLines].join("\n");
}
