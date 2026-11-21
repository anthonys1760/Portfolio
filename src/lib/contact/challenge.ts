import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DEV_SECRET = "dev-only-contact-secret-do-not-use-in-prod";
const TEN_MINUTES_MS = 10 * 60 * 1000;

export function resolveSecret(env: NodeJS.ProcessEnv = process.env): { secret: string; devFallback: boolean } | { error: "missing" } {
  const configured = env.CONTACT_SECRET ?? "";
  if (configured.length >= 32) return { secret: configured, devFallback: false };
  if (env.VERCEL_ENV === "production") return { error: "missing" };
  return { secret: DEV_SECRET, devFallback: true };
}

function hmac(material: string, secret: string): string {
  return createHmac("sha256", secret).update(material).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function signChallenge(
  answer: string,
  secret: string,
  now = Date.now(),
): { token: string; exp: number; nonce: string } {
  const exp = now + TEN_MINUTES_MS;
  const nonce = randomBytes(16).toString("hex");
  const sig = hmac(`${answer}|${exp}|${nonce}`, secret);
  return { token: `${exp}.${nonce}.${sig}`, exp, nonce };
}

export type VerifyResult =
  | { ok: true; nonce: string; exp: number }
  | { ok: false; reason: "malformed" | "mismatch" | "expired" };

/** Checks HMAC, answer, and expiry. Does not consume the nonce. */
export function verifyChallenge(token: string, answer: string, secret: string, now = Date.now()): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [expStr, nonce, sig] = parts;
  const exp = Number(expStr);
  if (!nonce || !sig || !Number.isFinite(exp)) return { ok: false, reason: "malformed" };
  const expected = hmac(`${answer.trim()}|${exp}|${nonce}`, secret);
  if (!safeEqual(expected, sig)) return { ok: false, reason: "mismatch" };
  if (now > exp) return { ok: false, reason: "expired" };
  return { ok: true, nonce, exp };
}

export function createChallenge(secret: string, now = Date.now()): { question: string; token: string; nonce: string; exp: number } {
  const a = 2 + Math.floor(Math.random() * 8);
  const b = 2 + Math.floor(Math.random() * 8);
  const signed = signChallenge(String(a + b), secret, now);
  return { question: `What is ${a} + ${b}?`, ...signed };
}

export function signRenderedAt(now: number, secret: string): string {
  return `${now}.${hmac(`rendered|${now}`, secret)}`;
}

export function readRenderedAt(token: string, secret: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [stamp, sig] = parts;
  if (!stamp || !sig || !/^\d+$/.test(stamp)) return null;
  const expected = hmac(`rendered|${stamp}`, secret);
  if (!safeEqual(expected, sig)) return null;
  return Number(stamp);
}

export function spamReasons(input: {
  honeypot: string;
  renderedAt: number | null;
  now: number;
  message: string;
  urlCount: number;
}): string[] {
  const reasons: string[] = [];
  if (input.honeypot.trim()) reasons.push("honeypot");
  if (input.renderedAt == null || input.now - input.renderedAt < 3000) reasons.push("fast");
  if (input.urlCount > 3) reasons.push("urls");
  return reasons;
}
