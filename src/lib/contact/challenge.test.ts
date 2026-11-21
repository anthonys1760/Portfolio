import { describe, expect, it } from "vitest";
import { createChallenge, readRenderedAt, signChallenge, signRenderedAt, spamReasons, verifyChallenge } from "./challenge";
import { memoryNonceStore } from "./nonce";
import { hashIp } from "./ratelimit";

const secret = "test-secret-must-be-at-least-32-bytes";

describe("challenge tokens", () => {
  it("signs and verifies an answer", () => {
    const now = 1_700_000_000_000;
    const signed = signChallenge("7", secret, now);
    expect(verifyChallenge(signed.token, "7", secret, now + 1000)).toEqual({
      ok: true,
      nonce: signed.nonce,
      exp: signed.exp,
    });
  });

  it("rejects a wrong answer", () => {
    const signed = signChallenge("7", secret, 1_000);
    expect(verifyChallenge(signed.token, "8", secret, 1_000).ok).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = 1_700_000_000_000;
    const signed = signChallenge("4", secret, now);
    const result = verifyChallenge(signed.token, "4", secret, signed.exp + 1);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a tampered nonce", () => {
    const signed = signChallenge("4", secret, 5_000);
    const [exp, , sig] = signed.token.split(".");
    const tampered = `${exp}.${"f".repeat(32)}.${sig}`;
    expect(verifyChallenge(tampered, "4", secret, 5_000)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("does not put the answer in the token", () => {
    const signed = signChallenge("11", secret, 5_000);
    expect(signed.token.includes("11")).toBe(false);
  });

  it("refuses nonce reuse and accepts a new nonce", async () => {
    const store = memoryNonceStore();
    const first = createChallenge(secret, 10_000);
    expect(await store.claim(first.nonce, 600)).toBe(true);
    expect(await store.claim(first.nonce, 600)).toBe(false);
    const second = createChallenge(secret, 10_000);
    expect(await store.claim(second.nonce, 600)).toBe(true);
  });

  it("round-trips a render timestamp and flags a fast submit", () => {
    const now = 50_000;
    const token = signRenderedAt(now, secret);
    expect(readRenderedAt(token, secret)).toBe(now);
    expect(readRenderedAt(`${now}.nope`, secret)).toBeNull();
    expect(
      spamReasons({ honeypot: "", renderedAt: now, now: now + 1000, message: "hi", urlCount: 0 }),
    ).toContain("fast");
    expect(
      spamReasons({ honeypot: "", renderedAt: now, now: now + 4000, message: "hi", urlCount: 0 }),
    ).toEqual([]);
    expect(
      spamReasons({ honeypot: "bot", renderedAt: now, now: now + 9000, message: "hi", urlCount: 4 }),
    ).toEqual(["honeypot", "urls"]);
  });

  it("hashes an IP without keeping the raw address", () => {
    const hash = hashIp("203.0.113.10", "salt-value");
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("203.0.113.10");
    expect(hashIp("203.0.113.10", "salt-value")).toBe(hash);
    expect(hashIp("203.0.113.10", "other-salt")).not.toBe(hash);
  });
});
