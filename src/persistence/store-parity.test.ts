import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { MemoryAppStore } from "./memory-store.js";
import { PostgresAppStore } from "./postgres-store.js";

const createPool = () => {
  const tenants = new Map<string, any>();
  const events: Array<{
    eventId: string;
    tenantId: string;
    occurredAt: string;
    entityType: string;
    entityId?: string;
    payload: any;
  }> = [];

  const pool = {
    query: async (sql: string, params: any[] = []) => {
      if (sql.includes("insert into tenants")) {
        const tenant = JSON.parse(params[3]);
        tenants.set(params[0], tenant);
        return { rows: [] };
      }

      if (sql.includes("select metadata, id, name, active, created_at, updated_at from tenants where active = true")) {
        const activeTenants = [...tenants.values()]
          .filter((tenant) => tenant.active)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
        return {
          rows: activeTenants.map((tenant) => ({
            metadata: tenant.metadata,
            id: tenant.id,
            name: tenant.name,
            active: tenant.active,
            created_at: new Date(tenant.createdAt),
            updated_at: new Date(tenant.updatedAt),
          })),
        };
      }

      if (sql.includes("select metadata, id, name, active, created_at, updated_at from tenants where id = $1")) {
        const tenant = tenants.get(params[0]);
        return {
          rows: tenant
            ? [
                {
                  metadata: tenant.metadata,
                  id: tenant.id,
                  name: tenant.name,
                  active: tenant.active,
                  created_at: new Date(tenant.createdAt),
                  updated_at: new Date(tenant.updatedAt),
                },
              ]
            : [],
        };
      }

      if (sql.includes("insert into normalized_events")) {
        const payload = JSON.parse(params[5]);
        events.push({
          eventId: params[0],
          tenantId: params[1],
          occurredAt: params[2],
          entityType: params[3],
          entityId: params[4] ?? undefined,
          payload,
        });
        return { rows: [] };
      }

      if (sql.includes("select payload from normalized_events where tenant_id = $1 and event_id = $2")) {
        const row = events.find((event) => event.tenantId === params[0] && event.eventId === params[1]);
        return { rows: row ? [{ payload: row.payload }] : [] };
      }

      if (sql.includes("from normalized_events")) {
        const [tenantId, entityType, entityId, limit] = params;
        const rows = events
          .filter((event) => event.tenantId === tenantId)
          .filter((event) => (entityType ? event.entityType === entityType : true))
          .filter((event) => (entityId ? event.entityId === entityId : true))
          .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
          .slice(0, limit)
          .map((event) => ({ payload: event.payload }));
        return { rows };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
    end: async () => {},
  } as unknown as Pool;

  return { pool, tenants, events };
};

describe("PostgresAppStore parity", () => {
  it("orders recent events the same way as MemoryAppStore", async () => {
    const memory = new MemoryAppStore();
    const { pool } = createPool();
    const postgres = new PostgresAppStore(pool);

    const tenant = {
      id: "tenant-1",
      name: "Tenant 1",
      active: true,
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    await memory.saveTenant(tenant);
    await postgres.saveTenant(tenant);

    const events = [
      {
        eventId: "event-1",
        tenantId: "tenant-1",
        amocrmAccountId: 1,
        entityType: "leads",
        entityId: "10",
        action: "update",
        occurredAt: "2026-03-25T00:00:00.000Z",
        receivedAt: "2026-03-25T00:01:00.000Z",
        rawPayload: {},
        normalizedPayload: {},
        dedupeKey: "dedupe-1",
      },
      {
        eventId: "event-2",
        tenantId: "tenant-1",
        amocrmAccountId: 1,
        entityType: "leads",
        entityId: "10",
        action: "add_note",
        occurredAt: "2026-03-25T00:02:00.000Z",
        receivedAt: "2026-03-25T00:02:30.000Z",
        rawPayload: {},
        normalizedPayload: {},
        dedupeKey: "dedupe-2",
      },
      {
        eventId: "event-3",
        tenantId: "tenant-1",
        amocrmAccountId: 1,
        entityType: "contacts",
        entityId: "99",
        action: "update",
        occurredAt: "2026-03-25T00:03:00.000Z",
        receivedAt: "2026-03-25T00:03:10.000Z",
        rawPayload: {},
        normalizedPayload: {},
        dedupeKey: "dedupe-3",
      },
    ];

    for (const event of events) {
      await memory.saveEvent(event);
      await postgres.saveEvent(event);
    }

    const memoryRecent = await memory.listEvents("tenant-1", { limit: 10, entityType: "leads", entityId: "10" });
    const postgresRecent = await postgres.listEvents("tenant-1", {
      limit: 10,
      entityType: "leads",
      entityId: "10",
    });

    expect(memoryRecent.map((event) => event.eventId)).toEqual(["event-2", "event-1"]);
    expect(postgresRecent.map((event) => event.eventId)).toEqual(["event-2", "event-1"]);
    expect(postgresRecent).toEqual(memoryRecent);
  });
});
