// ─── MCP Skill Client with Connection Pool ────────────────────────────────────
// Instead of spawning a new stdio subprocess per request,
// a single process per skill is kept alive to eliminate ~500ms/call overhead.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Skill dist paths (relative to the monorepo root)
const SKILL_PATHS: Record<string, string> = {
  "career-knowledge-base": resolve(
    __dirname,
    "../../mcp-skills/career-knowledge-base/dist/index.js"
  ),
  "career-plan-generator": resolve(
    __dirname,
    "../../mcp-skills/career-plan-generator/dist/index.js"
  ),
  "pdf-word-to-json": resolve(
    __dirname,
    "../../mcp-skills/pdf-word-to-json/dist/index.js"
  ),
  "resume-generator": resolve(
    __dirname,
    "../../mcp-skills/resume-generator/dist/index.js"
  ),
};

// ── Connection pool ───────────────────────────────────────────────────────────

interface PoolEntry {
  client: Client;
  transport: StdioClientTransport;
  healthy: boolean;
}

const pool = new Map<string, PoolEntry>();

async function buildEnv(): Promise<Record<string, string>> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) env[k] = v;
  }
  return env;
}

async function createPoolEntry(skillName: string): Promise<PoolEntry> {
  const skillPath = SKILL_PATHS[skillName];
  const env = await buildEnv();

  const transport = new StdioClientTransport({
    command: "node",
    args: [skillPath],
    env,
  });

  const client = new Client({ name: "readmycareer-agent", version: "1.0.0" });
  await client.connect(transport);

  const entry: PoolEntry = { client, transport, healthy: true };

  // Remove from pool when process exits
  transport.onclose = () => {
    const existing = pool.get(skillName);
    if (existing === entry) {
      existing.healthy = false;
      pool.delete(skillName);
      console.warn(`[MCP POOL] ${skillName} 프로세스가 종료되었습니다. 다음 호출 시 재연결합니다.`);
    }
  };

  return entry;
}

async function getPooledClient(skillName: string): Promise<Client> {
  const existing = pool.get(skillName);
  if (existing?.healthy) return existing.client;

  console.log(`[MCP POOL] ${skillName} 연결 생성 중...`);
  const entry = await createPoolEntry(skillName);
  pool.set(skillName, entry);
  return entry.client;
}

// Clean up all MCP clients on process exit
process.once("exit", () => {
  for (const [, entry] of pool) {
    try { entry.client.close(); } catch {}
  }
});
process.once("SIGTERM", () => process.exit(0));
process.once("SIGINT",  () => process.exit(0));

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Calls a specific tool on an MCP skill and returns the result.
 * Reuses stdio processes via the connection pool;
 * automatically reconnects if the process has died.
 *
 * @param skillName  Key in SKILL_PATHS (e.g. "career-knowledge-base")
 * @param toolName   MCP tool name (e.g. "search")
 * @param args       Tool input arguments
 */
export async function callMcpTool(
  skillName: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!SKILL_PATHS[skillName]) {
    throw new Error(
      `알 수 없는 MCP 스킬: ${skillName}. 가능한 스킬: ${Object.keys(SKILL_PATHS).join(", ")}`
    );
  }

  let attempt = 0;
  const maxAttempts = 2; // On first failure, reconnect and retry once

  while (attempt < maxAttempts) {
    try {
      const client = await getPooledClient(skillName);
      const result = await client.callTool({ name: toolName, arguments: args });

      const contentArr = result.content as Array<{ type: string; text?: string }>;
      const textContent = contentArr.find((c) => c.type === "text");
      if (!textContent?.text) {
        throw new Error(`MCP 툴 ${skillName}.${toolName} 응답에 텍스트 내용이 없습니다.`);
      }
      if (result.isError) {
        throw new Error(`MCP 툴 실행 오류 (${skillName}.${toolName}): ${textContent.text}`);
      }

      return JSON.parse(textContent.text) as unknown;
    } catch (err: any) {
      attempt++;
      const entry = pool.get(skillName);
      if (entry) {
        entry.healthy = false;
        pool.delete(skillName);
      }
      if (attempt >= maxAttempts) throw err;
      console.warn(`[MCP POOL] ${skillName} 재연결 시도 (${attempt}/${maxAttempts - 1})...`);
    }
  }

  throw new Error(`[MCP POOL] ${skillName}.${toolName} 호출 실패`);
}
