import { NextRequest, NextResponse } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";

const KB_SKILL_PATH = resolve(
  process.cwd(),
  "../mcp-skills/career-knowledge-base/dist/index.js"
);

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { confirm?: boolean };

    if (!body.confirm) {
      return NextResponse.json({
        status: "skipped",
        message: "confirm: true 를 전달해야 동기화가 실행됩니다.",
      });
    }

    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v;
    }

    const transport = new StdioClientTransport({
      command: "node",
      args: [KB_SKILL_PATH],
      env,
    });
    const client = new Client({ name: "next-api-sync", version: "1.0.0" });
    await client.connect(transport);

    const result = await client.callTool({
      name: "sync-drive",
      arguments: { confirm: true },
    });

    await client.close();

    const contentArr = result.content as Array<{ type: string; text?: string }>;
    const text = contentArr.find((c) => c.type === "text")?.text ?? "{}";

    return NextResponse.json(JSON.parse(text));
  } catch (err) {
    console.error("[/api/sync] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "동기화 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
