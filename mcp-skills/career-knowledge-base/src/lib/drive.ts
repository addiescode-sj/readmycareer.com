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
 * Returns a list of files in the specified folder ID.
 * - Supported formats: Google Docs, plain text (.txt), Markdown (.md)
 */
export async function listDriveFiles(folderId: string): Promise<DriveFile[]> {
  const auth = getAuthClient();
  const drive = google.drive({ version: "v3", auth });

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType)",
    pageSize: 200,
    orderBy: "name",
  });

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
    { fileId, alt: "media" },
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
    const end = Math.min(start + CHUNK_SIZE, text.length);
    let slice = text.slice(start, end);

    // Cut at sentence boundary unless this is the last chunk
    if (end < text.length) {
      const lastSentence = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf(".\n"),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("! ")
      );
      if (lastSentence > CHUNK_SIZE * 0.5) {
        slice = text.slice(start, start + lastSentence + 1);
      }
    }

    chunks.push(slice.trim());
    start += slice.length - CHUNK_OVERLAP;
  }

  return chunks.filter((c) => c.length > 0);
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
export async function syncDriveToVectorDB(): Promise<{ synced: number }> {
  const { upsertDocuments } = await import("./rag.js");

  const jdFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID_JD;
  const refFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID_REF;

  if (!jdFolderId && !refFolderId) {
    throw new Error(
      "Either GOOGLE_DRIVE_FOLDER_ID_JD or GOOGLE_DRIVE_FOLDER_ID_REF is required."
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
  return { synced: allDocs.length };
}