// RAG retrieval inspector — shows exactly which corpus chunks the agents would
// retrieve for a given query, using the SAME similaritySearch() path (hybrid + rerank)
// that ChatQnAAgent and the planner reference search use.
//
// Usage (from repo root):
//   node --env-file=.env mcp-skills/career-knowledge-base/scripts/inspect-retrieval.mjs "<query>" [doc_type]
//   doc_type: reference (default) | jd | all
//
// Requires PINECONE_API_KEY / PINECONE_INDEX_NAME (loaded from root .env via --env-file)
// and a built skill (pnpm --filter @readmycareer/mcp-career-knowledge-base build).

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist sits next to src/, two levels up from scripts/.
const ragPath = resolve(__dirname, "../dist/lib/rag.js");

const { similaritySearch } = await import(ragPath);

const query = process.argv[2] ?? "Backend Engineer cloud system design";
const docType = process.argv[3] ?? "reference"; // reference | jd | all

if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX_NAME) {
  console.error(
    "Missing PINECONE_API_KEY / PINECONE_INDEX_NAME. Run with:\n" +
      '  node --env-file=.env mcp-skills/career-knowledge-base/scripts/inspect-retrieval.mjs "<query>" [doc_type]'
  );
  process.exit(1);
}

const results = await similaritySearch(query, 5, { doc_type: docType });

console.log(`\nQuery:    "${query}"`);
console.log(`Filter:   doc_type = ${docType}`);
console.log(`Returned: ${results.length} chunk(s) — ranked by rerank score\n`);

results.forEach((r, i) => {
  const score = typeof r.score === "number" ? r.score.toFixed(4) : String(r.score);
  const snippet = (r.text ?? "").replace(/\s+/g, " ").slice(0, 180);
  console.log(`#${i + 1}  [${r.doc_type}]  score=${score}`);
  console.log(`    title : ${r.title}`);
  console.log(`    doc_id: ${r.doc_id}  (chunk ${r.chunk_index})`);
  console.log(`    text  : ${snippet}${(r.text ?? "").length > 180 ? "…" : ""}\n`);
});

if (results.length === 0) {
  console.log(
    "No hits. If doc_type=reference returns nothing, the reference corpus may not be " +
      "labeled yet — re-run sync with GOOGLE_DRIVE_FOLDER_ID_REF set."
  );
}
