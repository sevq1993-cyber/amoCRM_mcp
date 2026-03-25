import { createClient, type RedisClientType } from "redis";
import type { CacheAdapter } from "../types.js";

export class MemoryCacheAdapter implements CacheAdapter {
  private readonly windows = new Map<string, number[]>();
  private readonly keys = new Map<string, number>();

  async reserveWithinWindow(key: string, limit: number, windowMs: number): Promise<number> {
    const now = Date.now();
    const values = (this.windows.get(key) ?? []).filter((item) => now - item < windowMs);
    if (values.length < limit) {
      values.push(now);
      this.windows.set(key, values);
      return 0;
    }

    const earliest = values[0] ?? now;
    const waitMs = Math.max(windowMs - (now - earliest), 0);
    this.windows.set(key, values);
    return waitMs;
  }

  async putIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    const expiration = this.keys.get(key);

    if (expiration && expiration > now) {
      return false;
    }

    this.keys.set(key, now + ttlSeconds * 1000);
    return true;
  }

  async close(): Promise<void> {}
}

export class RedisCacheAdapter implements CacheAdapter {
  constructor(private readonly client: RedisClientType<any, any, any, any>) {}

  async reserveWithinWindow(key: string, limit: number, windowMs: number): Promise<number> {
    const count = await this.client.incr(key);

    if (count === 1) {
      await this.client.pExpire(key, windowMs);
    }

    if (count <= limit) {
      return 0;
    }

    const ttl = await this.client.pTTL(key);
    return ttl > 0 ? ttl : windowMs;
  }

  async putIfAbsent(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.client.set(key, "1", { NX: true, EX: ttlSeconds });
    return result === "OK";
  }

  async close(): Promise<void> {
    await this.client.quit();
  }
}

export const createCacheAdapter = async (redisUrl?: string): Promise<CacheAdapter> => {
  if (!redisUrl) {
    return new MemoryCacheAdapter();
  }

  const client = createClient({ url: redisUrl });
  await client.connect();
  return new RedisCacheAdapter(client);
};
