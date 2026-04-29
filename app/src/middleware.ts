import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * In-memory sliding window rate limiter based on client IP
 */
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

const LIMITS: Record<string, number> = {
  "/api/analyze": 20,
  "/api/chat": 20,
  "/api/resume": 10,
  "/api/sync": 5,
  "/api/career-plans": 20,
};

interface RateEntry {
  timestamps: number[];
}

const store = new Map<string, RateEntry>();


function getIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-pathname", pathname);

  // Initialize response
  let res = NextResponse.next({ request: { headers: requestHeaders } });

  // Update Supabase session
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  await supabase.auth.getUser();

  const limit = LIMITS[pathname];
  if (!limit) {
    return res;
  }

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

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
