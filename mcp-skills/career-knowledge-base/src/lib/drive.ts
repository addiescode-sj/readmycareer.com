// ─── Google Drive Connector ───────────────────────────────────────────────────
// Fetches JD / reference documents from a Google Drive folder using a service account and chunks them.

import { google } from "googleapis";
import type { JdDocument } from "./rag.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/**
 * Creates a service account auth client from the GOOGLE_SERVICE_ACCOUNT_KEY_JSON env var.
 *
 * Cloud Console setup:
 * 1. IAM & Admin > Service Accounts > Create key (JSON)
 * 2. Serialize the downloaded JSON file to a single line:
 * python3 -c "import json,sys; print(json.dumps(json.load(open('key.json'))))"
 * 3. Paste the result into GOOGLE_SERVICE_ACCOUNT_KEY_JSON in .env
 * 4. Share the target Drive folder with the service account email as 'Viewer'
 */
function getAuthClient() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  if (!keyJson) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_JSON environment variable is not set.");
  }

  let credentials: Record<string, unknown>;
  try {
    credentials = JSON.parse(keyJson) as Record<string, unknown>;
  } catch {
    throw new Error("Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY_JSON: Check if it is a valid JSON.");
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.readonly"],
  });
}

// ── Drive API helpers ─────────────────────────────────────────────────────────

/**
 * Normalizes a folder reference to a bare Drive ID.
 * Accepts a raw ID or a pasted URL like
 * `https://drive.google.com/drive/folders/<ID>?usp=sharing`.
 */
function normalizeFolderId(raw: string): string {
  const trimmed = (raw ?? "").trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  // Strip any leftover query string / slashes from a bare-ish value.
  return trimmed.replace(/[?#].*$/, "").replace(/\/+$/, "");
}

/**
 * Returns a list of files in the specified folder ID.
 * - Supported formats: Google Docs, plain text (.txt), Markdown (.md)
 */
export async function listDriveFiles(folderId: string): Promise<DriveFile[]> {
  // Accept either a bare folder ID or a pasted Drive URL and normalize to the ID.
  const id = normalizeFolderId(folderId);

  const auth = getAuthClient();
  const drive = google.drive({ version: "v3", auth });

  let res;
  try {
    res = await drive.files.list({
      q: `'${id}' in parents and trashed = false`,
      fields: "files(id, name, mimeType)",
      pageSize: 200,
      orderBy: "name",
      // Required for folders that live in a Shared Drive (Team Drive); harmless otherwise.
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to list Google Drive folder "${id}": ${msg}. ` +
        `Verify the folder ID is correct and shared (Viewer) with the service account.`
    );
  }

  const files = (res.data.files ?? []) as DriveFile[];
  const supported = new Set([
    "application/vnd.google-apps.document",
    "text/plain",
    "text/markdown",
  ]);

  return files.filter((f) => supported.has(f.mimeType));
}

/**
 * Extracts the contents of a single Drive file as plain text.
 */
async function exportFileAsText(
  fileId: string,
  mimeType: string
): Promise<string> {
  const auth = getAuthClient();
  const drive = google.drive({ version: "v3", auth });

  if (mimeType === "application/vnd.google-apps.document") {
    // Google Docs → plain text export
    const res = await drive.files.export(
      { fileId, mimeType: "text/plain" },
      { responseType: "text" }
    );
    return (res.data as string).trim();
  }

  // .txt / .md → media download
  const res = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "text" }
  );
  return (res.data as string).trim();
}

// ── Text chunking ─────────────────────────────────────────────────────────────

const CHUNK_SIZE = 1800;   // character count (~450 tokens)
const CHUNK_OVERLAP = 200; // characters overlapping with the previous chunk

/**
 * Splits long text into overlapping chunks respecting sentence boundaries.
 */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_SIZE) return [text];

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let sliceEnd = Math.min(start + CHUNK_SIZE, text.length);

    // Cut at a sentence boundary unless this is the last chunk
    if (sliceEnd < text.length) {
      const slice = text.slice(start, sliceEnd);
      const lastSentence = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf(".\n"),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! ")
      );
      if (lastSentence > CHUNK_SIZE * 0.5) {
        sliceEnd = start + lastSentence + 1;
      }
    }

    const piece = text.slice(start, sliceEnd).trim();
    if (piece.length > 0) chunks.push(piece);

    // Stop once this chunk reached the end of the text.
    if (sliceEnd >= text.length) break;

    // Advance with overlap, but ALWAYS move forward by at least 1 char so a
    // short tail slice (≤ CHUNK_OVERLAP) can never stall the loop forever.
    start += Math.max(sliceEnd - start - CHUNK_OVERLAP, 1);
  }

  return chunks;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Reads documents from a Google Drive folder and converts them to an array of JdDocument chunks.
 *
 * @param folderId  Drive ID of the target folder
 * @param docType   Document type ('jd' | 'reference')
 */
export async function fetchJdDocumentsFromDrive(
  folderId: string,
  docType: "jd" | "reference" = "jd"
): Promise<JdDocument[]> {
  const files = await listDriveFiles(folderId);
  const results: JdDocument[] = [];

  for (const file of files) {
    const text = await exportFileAsText(file.id, file.mimeType);
    const chunks = chunkText(text);

    chunks.forEach((chunk, idx) => {
      results.push({
        doc_id: `${file.id}_chunk_${idx}`,
        doc_type: docType,
        title: file.name,
        chunk_index: idx,
        text: chunk,
        metadata: {
          drive_file_id: file.id,
          mime_type: file.mimeType,
          total_chunks: chunks.length,
        },
      });
    });
  }

  return results;
}

/**
 * Reads both the JD folder and the reference folder and syncs them to the Vector DB.
 * Requires env vars GOOGLE_DRIVE_FOLDER_ID_JD and GOOGLE_DRIVE_FOLDER_ID_REF.
 *
 * @returns Total number of chunks synced
 */
export async function syncDriveToVectorDB(): Promise<{
  synced: number;
  by_doc_type: Record<string, number>;
}> {
  const { upsertDocuments } = await import("./rag.js");

  const jdFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID_JD;
  const refFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID_REF;

  if (!jdFolderId && !refFolderId) {
    throw new Error(
      "Either GOOGLE_DRIVE_FOLDER_ID_JD or GOOGLE_DRIVE_FOLDER_ID_REF is required."
    );
  }

  // Surface misconfiguration loudly. A missing REF folder silently means the career-trend
  // reference corpus is never labeled doc_type="reference", so reference-grounding retrieval
  // and the corresponding eval metrics return nothing — exactly the failure mode we hit.
  if (!refFolderId) {
    console.warn(
      '[sync-drive] GOOGLE_DRIVE_FOLDER_ID_REF is not set — career-trend reference documents ' +
        'will NOT be ingested as doc_type="reference". Reference-grounding retrieval and eval ' +
        "will stay empty until you set it and re-sync."
    );
  }
  if (!jdFolderId) {
    console.warn("[sync-drive] GOOGLE_DRIVE_FOLDER_ID_JD is not set — no JD documents will be ingested.");
  }
  if (jdFolderId && refFolderId && jdFolderId === refFolderId) {
    console.warn(
      "[sync-drive] GOOGLE_DRIVE_FOLDER_ID_JD and _REF point to the same folder — every document " +
        "is ingested twice and the 'reference' pass overwrites the 'jd' labels (same doc_id). " +
        "Use separate folders."
    );
  }

  const allDocs: JdDocument[] = [];

  if (jdFolderId) {
    const jdDocs = await fetchJdDocumentsFromDrive(jdFolderId, "jd");
    allDocs.push(...jdDocs);
  }

  if (refFolderId) {
    const refDocs = await fetchJdDocumentsFromDrive(refFolderId, "reference");
    allDocs.push(...refDocs);
  }

  await upsertDocuments(allDocs);

  // Per-type breakdown so the caller can immediately verify the reference corpus was labeled.
  const by_doc_type = allDocs.reduce<Record<string, number>>((acc, d) => {
    acc[d.doc_type] = (acc[d.doc_type] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[sync-drive] synced ${allDocs.length} chunks: ${JSON.stringify(by_doc_type)}`);

  return { synced: allDocs.length, by_doc_type };
}