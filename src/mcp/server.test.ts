import { describe, expect, it } from "vitest";
import type { AppContext } from "../runtime/app-context.js";
import { MemoryAppStore } from "../persistence/memory-store.js";
import { resolveContext } from "./server.js";

const createAppContext = async (store = new MemoryAppStore(), seedTenant = true) => {
  if (seedTenant) {
    await store.saveTenant({
      id: "tenant-1",
      name: "Tenant 1",
      active: true,
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }

  return {
    config: {
      env: {
        DEFAULT_TENANT_ID: "tenant-1",
        LOCAL_ADMIN_ACCOUNT_ID: "local-admin",
      },
    },
    store,
  } as unknown as AppContext;
};

const createExtra = (authInfo?: unknown) =>
  ({
    signal: new AbortController().signal,
    requestId: "request-1",
    sendNotification: async () => {},
    sendRequest: async () => {
      throw new Error("unexpected sendRequest call");
    },
    requestInfo: new Request("http://localhost/mcp"),
    authInfo,
  }) as any;

describe("mcp server policy", () => {
  it("rejects unauthenticated HTTP requests before tenant fallback", async () => {
    const app = await createAppContext();

    await expect(resolveContext(app, createExtra(), "tenant-1")).rejects.toMatchObject({
      statusCode: 401,
      code: "invalid_token",
    });
  });

  it("rejects inactive tenants", async () => {
    const store = new MemoryAppStore();
    await store.saveTenant({
      id: "tenant-1",
      name: "Tenant 1",
      active: false,
      metadata: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    const app = await createAppContext(store, false);
    const authInfo = {
      clientId: "client-1",
      scopes: ["crm.read"],
      extra: {
        tenantIds: ["tenant-1"],
        defaultTenantId: "tenant-1",
        subject: "local-admin",
      },
    };

    await expect(resolveContext(app, createExtra(authInfo), "tenant-1")).rejects.toMatchObject({
      statusCode: 403,
      code: "tenant_inactive",
    });
  });

  it("rejects cross-tenant requests when the tenant is outside the token grant", async () => {
    const app = await createAppContext();
    await app.store.saveTenant({
      id: "tenant-2",
      name: "Tenant 2",
      active: true,
      metadata: {},
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    });

    const authInfo = {
      clientId: "client-1",
      scopes: ["crm.read"],
      extra: {
        tenantIds: ["tenant-1"],
        defaultTenantId: "tenant-1",
        subject: "local-admin",
      },
    };

    await expect(resolveContext(app, createExtra(authInfo), "tenant-2")).rejects.toMatchObject({
      statusCode: 403,
      code: "cross_tenant_denied",
    });
  });
});
