// SSE client for POST /api/analyze. The route streams text/event-stream; the final
// payload arrives in the `event: result` frame and failures in the `event: error`
// frame. Mirrors run_fixture's stream handling in agent_harness.py: progress frames
// are ignored, a result frame is JSON-parsed, an error frame is surfaced as a message.

export interface AnalyzeResponse {
  statusCode: number | null;
  data: unknown | null;
  error: string | null;
}

export async function callAnalyze(
  endpoint: string,
  body: unknown,
  timeoutMs: number
): Promise<AnalyzeResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (resp.status !== 200) {
      const bodyPreview = (await resp.text()).slice(0, 300);
      return { statusCode: resp.status, data: null, error: `HTTP ${resp.status}: ${bodyPreview}` };
    }

    if (!resp.body) {
      return { statusCode: resp.status, data: null, error: "No response body from SSE stream" };
    }

    let data: unknown | null = null;
    let sseError: string | null = null;
    let currentEvent = "message";

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const handleLine = (line: string) => {
      if (line === "") {
        currentEvent = "message";
        return;
      }
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (currentEvent === "result") {
          try {
            data = JSON.parse(payload);
          } catch (exc) {
            sseError = `result payload not JSON: ${(exc as Error).message}`;
          }
        } else if (currentEvent === "error") {
          try {
            const parsed = JSON.parse(payload) as { message?: string };
            sseError = parsed.message ?? payload;
          } catch {
            sseError = payload;
          }
        }
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.search(/\r?\n/)) !== -1) {
        const line = buffer.slice(0, idx);
        const nl = buffer[idx] === "\r" && buffer[idx + 1] === "\n" ? 2 : 1;
        buffer = buffer.slice(idx + nl);
        handleLine(line);
      }
    }
    if (buffer.length > 0) handleLine(buffer);

    if (data === null) {
      return {
        statusCode: resp.status,
        data: null,
        error: sseError ?? "No `event: result` frame received from SSE stream",
      };
    }
    return { statusCode: resp.status, data, error: null };
  } catch (exc) {
    const err = exc as Error & { cause?: { code?: string } };
    if (err.name === "AbortError") {
      return { statusCode: null, data: null, error: "TIMEOUT — Try increasing the --timeout value." };
    }
    const code = err.cause?.code;
    if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET") {
      return {
        statusCode: null,
        data: null,
        error: "CONNECTION_REFUSED — Check if the server is running. (pnpm dev)",
      };
    }
    return { statusCode: null, data: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}
