import { NextRequest, NextResponse } from "next/server";

/**
 * In-memory sliding window rate limiter based on client IP
 *
 * Limitation: In serverless / multi-instance environments, counters are isolated per instance.
 * For production scale, replace with an external store such as Upstash Redis.
 */

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

const LIMITS: Record<string, number> = {
  "/api/analyze": 20,
  "/api/chat": 20,
  "/api/resume": 10,
  "/api/sync": 5,
};

interface RateEntry {
  timestamps: number[];
}

const store = new Map<string, RateEntry>();

// Periodically clean up stale entries (prevent memory leak)
setInterval(() => {
  const now = Date.now();
  Array.from(store.entries()).forEach(([key, entry]) => {
    const valid = entry.timestamps.filter((t: number) => now - t < WINDOW_MS);
    if (valid.length === 0) {
      store.delete(key);
    } else {
      entry.timestamps = valid;
    }
  });
}, WINDOW_MS);

function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const limit = LIMITS[pathname];
  if (!limit) return NextResponse.next();

  const ip = getIp(req);
  const key = `${ip}:${pathname}`;
  const now = Date.now();

  const entry = store.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => now - t < WINDOW_MS);

  if (entry.timestamps.length >= limit) {
    return new NextResponse(
      JSON.stringify({ error: "요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(Math.ceil(WINDOW_MS / 1000)),
        },
      }
    );
  }

  entry.timestamps.push(now);
  store.set(key, entry);

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/analyze", "/api/chat", "/api/resume", "/api/sync"],
};
