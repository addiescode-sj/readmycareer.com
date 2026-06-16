// CSV read/write helpers matching the Python harness's `csv` module output:
//   - files are written UTF-8 with a BOM (Python's encoding="utf-8-sig"),
//   - cell stringification mirrors Python's str(): True/False, "" for None,
//     and Python-repr for lists (e.g. [] and ['msg']),
//   - QUOTE_MINIMAL quoting (only when a cell contains a comma, quote, or newline).

import { readFileSync, writeFileSync } from "node:fs";

const BOM = "﻿";

/** Mirrors Python str() for the value types the harness writes into CSV cells. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return "[" + value.map(pyRepr).join(", ") + "]";
  }
  return String(value);
}

/**
 * Mirrors Python str()/repr() for a float value, which the CSV writer reaches via
 * csv.DictWriter -> str(). Unlike JS String(), Python renders integer-valued floats
 * with a trailing ".0" (0.0 -> "0.0", 1.0 -> "1.0") and switches to exponential form
 * for magnitudes < 1e-4 or >= 1e16 (3e-05). Applied only to columns the harness knows
 * are floats — integers (token counts) must stay bare.
 */
export function pyFloatRepr(n: number): string {
  if (Number.isNaN(n)) return "nan";
  if (n === Infinity) return "inf";
  if (n === -Infinity) return "-inf";
  if (n === 0) return Object.is(n, -0) ? "-0.0" : "0.0";
  const a = Math.abs(n);
  if (a < 1e-4 || a >= 1e16) {
    // Exponential form; pad the exponent to at least two digits, like CPython (e-05).
    return n.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
  }
  if (Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

/** Python repr() for list elements (strings get single quotes). */
function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return "'" + value.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  return String(value);
}

function escapeCell(cell: string): string {
  if (/[",\r\n]/.test(cell)) {
    return '"' + cell.replace(/"/g, '""') + '"';
  }
  return cell;
}

/** Writes rows (objects keyed by fieldnames) as a UTF-8-BOM CSV, like csv.DictWriter. */
export function writeCsv(
  path: string,
  fieldnames: string[],
  rows: Record<string, unknown>[]
): void {
  const lines: string[] = [];
  lines.push(fieldnames.map((f) => escapeCell(f)).join(","));
  for (const row of rows) {
    lines.push(fieldnames.map((f) => escapeCell(pyStr(row[f]))).join(","));
  }
  // Python's csv writer terminates every record with \r\n by default.
  writeFileSync(path, BOM + lines.join("\r\n") + "\r\n", "utf8");
}

/** Writes a matrix of pre-stringified rows (like csv.writer.writerow over lists). */
export function writeCsvRows(path: string, rows: string[][]): void {
  const text = rows.map((r) => r.map((c) => escapeCell(c)).join(",")).join("\r\n");
  writeFileSync(path, BOM + text + "\r\n", "utf8");
}

/** Parses CSV text (RFC-4180-ish) into a list of records keyed by the header row. */
export function parseCsv(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  const records = parseRows(text);
  if (records.length === 0) return [];
  const headers = records[0];
  return records.slice(1).map((cells) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
}

/** Reads a CSV file into records; returns [] if the file is absent. */
export function readRows(path: string): Record<string, string>[] {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  return parseCsv(text);
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush trailing field/row unless the file ended exactly on a row break.
  if (field !== "" || row.length > 0) endRow();
  return rows;
}
