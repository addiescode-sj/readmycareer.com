import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { similaritySearch } from "./lib/rag.js";
import { syncDriveToVectorDB } from "./lib/drive.js";

// ─── Input / Output Schemas ───────────────────────────────────────────────────

export const SearchInputSchema = z.object({
  query: z.string().describe("Natural language search query (JD keywords, skill names, job titles, etc.)"),
  top_k: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of document chunks to return"),
  filter: z
    .object({
      doc_type: z
        .enum(["jd", "reference", "all"])
        .default("all")
        .describe("Target document type for the search"),
      tags: z
        .array(z.string())
        .optional()
        .describe("List of tags to filter by (e.g. ['backend', 'python'])"),
    })
    .optional(),
  hybrid: z.boolean().default(true).describe("Whether to apply Dense + BM25 hybrid search"),
  rerank: z.boolean().default(true).describe("Whether to apply Pinecone Inference Reranking"),
  candidate_multiplier: z.number().int().min(1).max(5).default(3).describe("Candidate multiplier for RRF fusion"),
});

export const SearchOutputSchema = z.object({
  query: z.string(),
  results: z.array(
    z.object({
      doc_id: z.string(),
      doc_type: z.enum(["jd", "reference"]),
      title: z.string(),
      chunk_index: z.number().int(),
      score: z.number().describe("Similarity score (0-1)"),
      text: z.string().describe("Retrieved text chunk"),
      metadata: z
        .record(z.unknown())
        .optional()
        .describe("Additional metadata from the source document"),
    })
  ),
  total_found: z.number().int(),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;
export type SearchOutput = z.infer<typeof SearchOutputSchema>;

// ─── Tool: search ─────────────────────────────────────────────────────────────

async function searchKnowledgeBase(input: SearchInput): Promise<SearchOutput> {
  const rawResults = await similaritySearch(
    input.query,
    input.top_k,
    input.filter
      ? {
        doc_type: input.filter.doc_type,
        tags: input.filter.tags,
      }
      : undefined,
    {
      hybrid: input.hybrid,
      rerank: input.rerank,
      candidateMultiplier: input.candidate_multiplier,
    }
  );

  const results = rawResults.map((r) => ({
    doc_id: r.doc_id,
    doc_type: r.doc_type as "jd" | "reference",
    title: r.title,
    chunk_index: r.chunk_index,
    score: r.score,
    text: r.text,
    metadata: r.metadata,
  }));

  return {
    query: input.query,
    results,
    total_found: results.length,
  };
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "career-knowledge-base",
  version: "0.1.0",
});

// Tool 1: RAG search (called by ChatQnAAgent → GapAnalyzerAgent)
server.tool(
  "search",
  "Searches for JD/career reference documents in the RAG Vector DB and returns relevant text chunks.",
  SearchInputSchema.shape,
  async (args) => {
    const input = SearchInputSchema.parse(args);
    const output = await searchKnowledgeBase(input);
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    };
  }
);

// Tool 2: Google Drive → Vector DB sync (for manual trigger or cron jobs)
server.tool(
  "sync-drive",
  "Reads JD/reference documents from Google Drive folders and embeds/stores them in the Vector DB. Requires GOOGLE_DRIVE_FOLDER_ID_JD / GOOGLE_DRIVE_FOLDER_ID_REF environment variables.",
  {
    confirm: z
      .boolean()
      .default(false)
      .describe("Must be set to true to actually execute the synchronization (safety guard)"),
  },
  async (args) => {
    const { confirm } = args as { confirm: boolean };

    if (!confirm) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "skipped",
              message: "Synchronization skipped. Set 'confirm: true' to execute.",
            }),
          },
        ],
      };
    }

    const result = await syncDriveToVectorDB();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "ok",
            synced_chunks: result.synced,
          }),
        },
      ],
    };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);