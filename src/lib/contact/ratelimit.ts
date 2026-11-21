import { createHash } from "node:crypto";

export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

export function clientIp(headerValue: string | null, realIp: string | null): string {
  if (headerValue) return headerValue.split(",")[0]?.trim() || "unknown";
  return realIp?.trim() || "unknown";
}

export type LimitResult =
  | { ok: true; skipped?: boolean }
  | { ok: false; retryAfter: number }
  | { ok: false; unavailable: true };

type Limiter = { limit: (id: string) => Promise<{ success: boolean; reset: number }> };

let cached: { short: Limiter; day: Limiter } | null = null;

async function limiters(): Promise<{ short: Limiter; day: Limiter } | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  if (cached) return cached;
  const { Redis } = await import("@upstash/redis");
  const { Ratelimit } = await import("@upstash/ratelimit");
  const redis = new Redis({ url, token });
  cached = {
    short: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, "10 m"),
      prefix: "contact:10m",
      analytics: false,
    }),
    day: new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(10, "24 h"),
      prefix: "contact:24h",
      analytics: false,
    }),
  };
  return cached;
}

export async function enforceRateLimit(ipHash: string, now = Date.now()): Promise<LimitResult> {
  // No in-memory fallback in production. Missing Redis fails closed.
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    if (process.env.VERCEL_ENV === "production") return { ok: false, unavailable: true };
    return { ok: true, skipped: true };
  }
  try {
    const pair = await limiters();
    if (!pair) return process.env.VERCEL_ENV === "production" ? { ok: false, unavailable: true } : { ok: true, skipped: true };
    const [short, day] = await Promise.all([pair.short.limit(ipHash), pair.day.limit(ipHash)]);
    if (short.success && day.success) return { ok: true };
    const reset = Math.max(short.success ? 0 : short.reset, day.success ? 0 : day.reset);
    const retryAfter = Math.max(1, Math.ceil((reset - now) / 1000));
    return { ok: false, retryAfter };
  } catch {
    return { ok: false, unavailable: true };
  }
}
