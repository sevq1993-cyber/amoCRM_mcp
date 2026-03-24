import { describe, expect, it } from "vitest";
import { MemoryAppStore } from "./memory-store.js";

describe("MemoryAppStore", () => {
  it("stores tenants and audit records", async () => {
    const store = new MemoryAppStore();
    await store.saveTenant({
      id: "tenant-1",
      name: "Tenant 1",
      active: true,
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    await store.saveAuditRecord({
      id: "audit-1",
      tenantId: "tenant-1",
      actor: "tester",
      action: "demo",
      target: "target",
      destructive: false,
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(await store.getDefaultTenant()).toMatchObject({ id: "tenant-1" });
    expect(await store.listAuditRecords("tenant-1")).toHaveLength(1);
  });
});
