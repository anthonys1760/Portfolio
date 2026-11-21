import { createChallenge, readRenderedAt, resolveSecret, spamReasons, verifyChallenge } from "./challenge";
import { deliverContact } from "./delivery";
import { logContact } from "./log";
import { memoryNonceStore, redisNonceStore, type NonceStore } from "./nonce";
import { clientIp, enforceRateLimit, hashIp } from "./ratelimit";
import { CHALLENGE_MISMATCH, countUrls, validateContact, type FieldErrors } from "./validation";

const MAX_BODY = 10 * 1024;
const PRODUCTION_HOSTS = new Set(["anthonysdigital.net", "www.anthonysdigital.net"]);

export type ContactFields = { name: string; email: string; message: string; company: string; rendered: string; challengeAnswer: string; challengeToken: string };

export type ContactResponse = {
  status: number;
  json: Record<string, unknown>;
  redirect: string;
  retryAfter?: number;
  draft?: { name: string; email: string; message: string; errors?: FieldErrors };
  ack?: { name: string; email: string };
  clearDraft?: boolean;
};

function emptyFields(): ContactFields {
  return { name: "", email: "", message: "", company: "", rendered: "", challengeAnswer: "", challengeToken: "" };
}

export function originAllowed(origin: string | null, env = process.env.VERCEL_ENV): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.host.toLowerCase();
  if (PRODUCTION_HOSTS.has(host)) return url.protocol === "https:";
  if (host.endsWith(".vercel.app")) return url.protocol === "https:";
  if (env !== "production" && (host.startsWith("localhost:") || host.startsWith("127.0.0.1:") || host === "localhost" || host === "127.0.0.1")) {
    return url.protocol === "http:" || url.protocol === "https:";
  }
  return false;
}

async function readFields(request: Request): Promise<{ fields: ContactFields } | { error: "size" | "type" }> {
  const contentType = (request.headers.get("content-type") || "").toLowerCase();
  const isJson = contentType.includes("application/json");
  const isUrlEncoded = contentType.includes("application/x-www-form-urlencoded");
  const isMultipart = contentType.includes("multipart/form-data");
  if (!isJson && !isUrlEncoded && !isMultipart) return { error: "type" };

  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > MAX_BODY) return { error: "size" };

  if (isMultipart) {
    const buffered = await request.clone().arrayBuffer();
    if (buffered.byteLength > MAX_BODY) return { error: "size" };
    const form = await request.formData();
    const fields = emptyFields();
    for (const key of Object.keys(fields) as (keyof ContactFields)[]) {
      const value = form.get(key);
      fields[key] = typeof value === "string" ? value : "";
    }
    return { fields };
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY) return { error: "size" };
  const fields = emptyFields();
  if (isJson) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return { error: "type" };
    }
    if (!data || typeof data !== "object") return { error: "type" };
    const record = data as Record<string, unknown>;
    for (const key of Object.keys(fields) as (keyof ContactFields)[]) {
      const value = record[key];
      fields[key] = typeof value === "string" ? value : "";
    }
    return { fields };
  }
  const params = new URLSearchParams(raw);
  for (const key of Object.keys(fields) as (keyof ContactFields)[]) {
    fields[key] = params.get(key) ?? "";
  }
  return { fields };
}

const devNonceStore = memoryNonceStore();

function nonceStore(): NonceStore {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    return {
      async claim(nonce, ttl) {
        const { Redis } = await import("@upstash/redis");
        const redis = new Redis({ url, token });
        return redisNonceStore(redis).claim(nonce, ttl);
      },
    };
  }
  if (process.env.VERCEL_ENV === "production") {
    return {
      async claim() {
        throw new Error("redis-required");
      },
    };
  }
  return devNonceStore;
}

function respond(partial: Omit<ContactResponse, "json" | "redirect"> & { json?: Record<string, unknown>; redirect?: string }): ContactResponse {
  return {
    status: partial.status,
    json: partial.json ?? {},
    redirect: partial.redirect ?? "/contact?error=send",
    retryAfter: partial.retryAfter,
    draft: partial.draft,
    ack: partial.ack,
    clearDraft: partial.clearDraft,
  };
}

export async function handleContact(request: Request, now = Date.now()): Promise<ContactResponse> {
  if (!originAllowed(request.headers.get("origin"))) {
    logContact("invalid");
    return respond({ status: 403, json: { ok: false, code: "rejected" }, redirect: "/contact?error=send" });
  }

  const parsed = await readFields(request);
  if ("error" in parsed) {
    logContact("invalid");
    const status = parsed.error === "size" ? 413 : 415;
    return respond({ status, json: { ok: false, code: "rejected" }, redirect: "/contact?error=send" });
  }
  const fields = parsed.fields;
  const checked = validateContact(fields);
  if (Object.keys(checked.errors).length) {
    logContact("invalid");
    return respond({
      status: 400,
      json: { ok: false, code: "validation", fields: checked.errors },
      redirect: "/contact?error=invalid",
      draft: { ...checked, errors: checked.errors },
    });
  }

  const salt = process.env.IP_HASH_SALT || "";
  if (process.env.VERCEL_ENV === "production" && salt.length < 16) {
    logContact("provider_error");
    return respond({ status: 503, json: { ok: false, code: "provider_error" }, redirect: "/contact?error=send", draft: checked });
  }
  const ip = clientIp(request.headers.get("x-forwarded-for"), request.headers.get("x-real-ip"));
  const ipHash = hashIp(ip, salt || "dev-salt");
  const limit = await enforceRateLimit(ipHash, now);
  if ("unavailable" in limit) {
    logContact("provider_error");
    return respond({ status: 503, json: { ok: false, code: "provider_error" }, redirect: "/contact?error=send", draft: checked });
  }
  if (!limit.ok) {
    logContact("rate_limited");
    return respond({
      status: 429,
      json: { ok: false, code: "rate_limited", retryAfter: limit.retryAfter },
      redirect: "/contact?error=rate",
      retryAfter: limit.retryAfter,
      draft: checked,
    });
  }
  if (limit.skipped) logContact("rate_limit_skipped");

  const secretResult = resolveSecret();
  if ("error" in secretResult) {
    logContact("provider_error");
    return respond({ status: 503, json: { ok: false, code: "provider_error" }, redirect: "/contact?error=send", draft: checked });
  }
  const secret = secretResult.secret;

  const renderedAt = fields.rendered ? readRenderedAt(fields.rendered, secret) : null;
  const reasons = spamReasons({
    honeypot: fields.company,
    renderedAt,
    now,
    message: checked.message,
    urlCount: countUrls(checked.message),
  });

  const issue = () => {
    const challenge = createChallenge(secret, now);
    logContact("challenge");
    return respond({
      status: 409,
      json: { ok: false, code: "challenge_required", question: challenge.question, token: challenge.token },
      redirect: `/contact?challenge=1&q=${encodeURIComponent(challenge.question)}&token=${encodeURIComponent(challenge.token)}`,
      draft: checked,
    });
  };

  if (fields.challengeToken) {
    const verified = verifyChallenge(fields.challengeToken, fields.challengeAnswer, secret, now);
    if (!verified.ok) {
      const challenge = createChallenge(secret, now);
      logContact("challenge");
      return respond({
        status: 409,
        json: {
          ok: false,
          code: "challenge_required",
          question: challenge.question,
          token: challenge.token,
          fieldError: CHALLENGE_MISMATCH,
        },
        redirect: `/contact?challenge=1&q=${encodeURIComponent(challenge.question)}&token=${encodeURIComponent(challenge.token)}&mismatch=1`,
        draft: { ...checked, errors: { challenge: CHALLENGE_MISMATCH } },
      });
    }
    try {
      const fresh = await nonceStore().claim(verified.nonce, 10 * 60);
      if (!fresh) return issue();
    } catch {
      logContact("provider_error");
      return respond({ status: 503, json: { ok: false, code: "provider_error" }, redirect: "/contact?error=send", draft: checked });
    }
  } else if (reasons.length) {
    return issue();
  }

  const sent = await deliverContact(checked);
  if (!sent.ok) {
    logContact("provider_error");
    return respond({ status: 503, json: { ok: false, code: "provider_error" }, redirect: "/contact?error=send", draft: checked });
  }
  logContact(sent.mode === "stubbed" ? "stubbed" : "sent");
  return respond({
    status: 200,
    json: { ok: true },
    redirect: "/contact?sent=1",
    ack: { name: checked.name, email: checked.email },
    clearDraft: true,
  });
}
