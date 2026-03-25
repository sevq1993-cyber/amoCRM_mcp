import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryCacheAdapter, RedisCacheAdapter } from "./cache.js";

afterEach(() => {
  vi.useRealTimers();
});

const createRedisClientMock = () => {
  let now = 0;
  const counters = new Map<string, number>();
  const expirations = new Map<string, number>();

  return {
    setNow(value: number) {
      now = value;
    },
    client: {
      incr: async (key: string) => {
        const expiresAt = expirations.get(key);
        if (typeof expiresAt === "number" && expiresAt <= now) {
          counters.set(key, 0);
          expirations.delete(key);
        }

        const next = (counters.get(key) ?? 0) + 1;
        counters.set(key, next);
        return next;
      },
      pExpire: async (key: string, windowMs: number) => {
        expirations.set(key, now + windowMs);
      },
      pTTL: async (key: string) => {
        const expiresAt = expirations.get(key);
        return typeof expiresAt === "number" ? expiresAt - now : -1;
      },
      set: async () => "OK",
      quit: async () => {},
    } as any,
  };
};

describe("MemoryCacheAdapter", () => {
  it("matches redis-style cooldown semantics after rejected attempts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);

    const cache = new MemoryCacheAdapter();

    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(0);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(0);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(1000);

    vi.setSystemTime(500);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(500);

    vi.setSystemTime(1000);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(0);
  });
});

describe("RedisCacheAdapter", () => {
  it("uses the same cooldown contract as the memory adapter", async () => {
    const mock = createRedisClientMock();
    const cache = new RedisCacheAdapter(mock.client);

    mock.setNow(0);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(0);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(0);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(1000);

    mock.setNow(500);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(500);

    mock.setNow(1000);
    expect(await cache.reserveWithinWindow("rate", 2, 1000)).toBe(0);
  });
});
