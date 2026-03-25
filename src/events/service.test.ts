import { describe, expect, it } from "vitest";
import type { AppStore, CacheAdapter, NormalizedAmoEvent } from "../types.js";
import { EventService } from "./service.js";

const createStore = (): AppStore => {
  const events = new Map<string, NormalizedAmoEvent>();

  return {
    initialize: async () => {},
    close: async () => {},
    listTenants: async () => [],
    getTenant: async () => undefined,
    saveTenant: async () => {},
    getDefaultTenant: async () => undefined,
    getInstallation: async () => undefined,
    saveInstallation: async () => {},
    listClientRegistrations: async () => [],
    getClientRegistration: async () => undefined,
    saveClientRegistration: async () => {},
    listTenantGrants: async () => [],
    saveTenantGrant: async () => {},
    listAccounts: async () => [],
    getAccount: async () => undefined,
    saveAccount: async () => {},
    saveEvent: async (event) => {
      events.set(`${event.tenantId}:${event.eventId}`, event);
    },
    getEvent: async (tenantId, eventId) => events.get(`${tenantId}:${eventId}`),
    listEvents: async (tenantId, options) =>
      [...events.values()]
        .filter((event) => event.tenantId === tenantId)
        .filter((event) => (options?.entityType ? event.entityType === options.entityType : true))
        .filter((event) => (options?.entityId ? event.entityId === options.entityId : true))
        .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
        .slice(0, options?.limit ?? 50),
    saveAuditRecord: async () => {},
    listAuditRecords: async () => [],
  };
};

const createCache = (): CacheAdapter => {
  const seen = new Set<string>();

  return {
    reserveWithinWindow: async () => 0,
    putIfAbsent: async (key) => {
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    },
    close: async () => {},
  };
};

describe("EventService", () => {
  it("deduplicates repeated webhook events", async () => {
    const store = createStore();
    const service = new EventService(store, createCache());
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

  it("replays the target event with related entity history", async () => {
    const store = createStore();
    const service = new EventService(store, createCache());
    const first = {
      eventId: "event-1",
      tenantId: "tenant-1",
      amocrmAccountId: 1,
      entityType: "leads",
      entityId: "10",
      action: "update",
      occurredAt: "2026-03-25T00:00:00.000Z",
      receivedAt: "2026-03-25T00:00:00.000Z",
      rawPayload: {},
      normalizedPayload: {},
      dedupeKey: "dedupe-key-1",
    };
    const second = {
      eventId: "event-2",
      tenantId: "tenant-1",
      amocrmAccountId: 1,
      entityType: "leads",
      entityId: "10",
      action: "add_note",
      occurredAt: "2026-03-25T00:01:00.000Z",
      receivedAt: "2026-03-25T00:01:00.000Z",
      rawPayload: {},
      normalizedPayload: {},
      dedupeKey: "dedupe-key-2",
    };
    const unrelated = {
      eventId: "event-3",
      tenantId: "tenant-1",
      amocrmAccountId: 1,
      entityType: "contacts",
      entityId: "99",
      action: "update",
      occurredAt: "2026-03-25T00:02:00.000Z",
      receivedAt: "2026-03-25T00:02:00.000Z",
      rawPayload: {},
      normalizedPayload: {},
      dedupeKey: "dedupe-key-3",
    };

    await service.ingest([first, second, unrelated]);
    const replay = await service.replay("tenant-1", "event-1", { limit: 10 });

    expect(replay.event).toMatchObject({
      eventId: "event-1",
      entityType: "leads",
      entityId: "10",
    });
    expect(replay.related).toHaveLength(2);
    expect(replay.related.map((event) => event.eventId)).toEqual(["event-2", "event-1"]);
  });

  it("fails with a typed not-found error when replay target is missing", async () => {
    const store = createStore();
    const service = new EventService(store, createCache());

    await expect(service.replay("tenant-1", "missing-event")).rejects.toMatchObject({
      name: "AppError",
      statusCode: 404,
      code: "event_not_found",
      message: "Event missing-event not found",
    });
  });
});
