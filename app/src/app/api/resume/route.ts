import { NextRequest, NextResponse } from "next/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve } from "path";

const PDF_SKILL_PATH = resolve(
  process.cwd(),
  "../mcp-skills/pdf-word-to-json/dist/index.js"
);

const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

const MCP_TIMEOUT_MS = 30_000;

export async function POST(req: NextRequest) {
  let client: Client | null = null;
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }

    const MAX_SIZE_MB = 10;
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return NextResponse.json(
        { error: `파일 크기는 ${MAX_SIZE_MB}MB 이하여야 합니다.` },
        { status: 400 }
      );
    }

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!["pdf", "docx", "doc"].includes(ext)) {
      return NextResponse.json(
        { error: "PDF 또는 Word 파일만 지원합니다." },
        { status: 400 }
      );
    }

    // Validate MIME type (prevent extension spoofing)
    if (file.type && !ALLOWED_MIMES.has(file.type)) {
      return NextResponse.json(
        { error: "허용되지 않는 파일 형식입니다." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");
    const fileType = ext === "pdf" ? "pdf" : "docx";

    // Call the pdf-word-to-json MCP skill — pass only required env vars
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      NODE_ENV: process.env.NODE_ENV ?? "production",
      ...(process.env.GOOGLE_API_KEY && { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY }),
      ...(process.env.GOOGLE_GENAI_API_KEY && { GOOGLE_GENAI_API_KEY: process.env.GOOGLE_GENAI_API_KEY }),
      ...(process.env.GEMINI_API_KEY && { GEMINI_API_KEY: process.env.GEMINI_API_KEY }),
    };

    const transport = new StdioClientTransport({
      command: "node",
      args: [PDF_SKILL_PATH],
      env,
    });
    client = new Client({ name: "next-api", version: "1.0.0" });
    await client.connect(transport);

    const result = await Promise.race([
      client.callTool({
        name: "parse_resume",
        arguments: {
          file_base64: base64,
          file_name: file.name,
          file_type: fileType,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("MCP 타임아웃")), MCP_TIMEOUT_MS)
      ),
    ]);

    const contentArr = result.content as Array<{ type: string; text?: string }>;
    const text = contentArr.find((c) => c.type === "text")?.text ?? "{}";

    if (result.isError) {
      throw new Error("이력서 파싱에 실패했습니다.");
    }

    // Strip personal contact info (name, email, phone, etc.) before returning to the client
    const { personal: _personal, ...resumeWithoutPersonal } = JSON.parse(text);
    return NextResponse.json(resumeWithoutPersonal);
  } catch (err) {
    console.error("[/api/resume] Error:", err);
    return NextResponse.json(
      { error: "이력서 파싱 중 오류가 발생했습니다." },
      { status: 500 }
    );
  } finally {
    await client?.close().catch(() => {});
  }
}
