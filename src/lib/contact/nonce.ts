export interface NonceStore {
  /** True when this nonce was stored for the first time. */
  claim(nonce: string, ttlSeconds: number): Promise<boolean>;
}

export function memoryNonceStore(): NonceStore {
  const seen = new Map<string, number>();
  return {
    async claim(nonce, ttlSeconds) {
      const now = Date.now();
      const exp = seen.get(nonce);
      if (exp && exp > now) return false;
      seen.set(nonce, now + ttlSeconds * 1000);
      return true;
    },
  };
}

/**
 * Single-use nonce in Redis. There is no in-memory fallback on production;
 * callers must only use memoryNonceStore from tests or non-production.
 */
export function redisNonceStore(redis: { set: Function }): NonceStore {
  return {
    async claim(nonce, ttlSeconds) {
      const result = await redis.set(`contact:nonce:${nonce}`, "1", { nx: true, ex: ttlSeconds });
      return result === "OK";
    },
  };
}
