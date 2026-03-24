import { describe, expect, it } from "vitest";
import { MemoryCacheAdapter } from "../persistence/cache.js";
import { MemoryAppStore } from "../persistence/memory-store.js";
import { EventService } from "./service.js";

describe("EventService", () => {
  it("deduplicates repeated webhook events", async () => {
    const store = new MemoryAppStore();
    const service = new EventService(store, new MemoryCacheAdapter());
    const baseEvent = {
      eventId: "event-1",
      tenantId: "tenant-1",
      amocrmAccountId: 1,
      entityType: "leads",
      entityId: "10",
      action: "update",
      occurredAt: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      rawPayload: {},
      normalizedPayload: {},
      dedupeKey: "dedupe-key",
    };

    const first = await service.ingest([baseEvent]);
    const second = await service.ingest([baseEvent]);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
    expect(await store.listEvents("tenant-1", { limit: 10 })).toHaveLength(1);
  });
});
