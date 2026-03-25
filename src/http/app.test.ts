import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createHttpApp } from "./app.js";
import type { OidcFacade } from "../auth/oidc.js";
import type { AmoCrmClient } from "../amocrm/client.js";
import type { AuditService } from "../audit/service.js";
import type { EventService } from "../events/service.js";
import { MemoryAppStore } from "../persistence/memory-store.js";
import type { AppConfig } from "../config.js";
import type { AppContext } from "../runtime/app-context.js";
import { AppError } from "../utils/errors.js";
import { nowIso } from "../utils/time.js";

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const createConfig = (overrides?: Partial<AppConfig["env"]>) =>
  ({
    env: {
      NODE_ENV: "development",
      DEFAULT_TENANT_ID: "tenant-a",
      POSTGRES_URL: undefined,
      REDIS_URL: undefined,
      HTTP_BIND_HOST: "127.0.0.1",
      MCP_HTTP_PATH: "/mcp",
      WEBHOOK_SHARED_SECRET: "webhook-secret-123",
      ...overrides,
    },
    issuerUrl: new URL("http://localhost:3456/"),
    baseUrl: new URL("http://localhost:3456/"),
    mcpUrl: new URL("http://localhost:3456/mcp"),
    oauthProtectedResourceMetadataPath: "/.well-known/oauth-protected-resource/mcp",
    amoRedirectUri: "http://localhost:3456/oauth/amocrm/callback",
    defaultClient: {
      clientId: "local-dev-client",
      clientName: "Local Dev Client",
      clientSecret: "dev-secret",
      redirectUris: ["http://127.0.0.1:8787/callback"],
      grantTypes: ["authorization_code", "refresh_token", "client_credentials"],
      responseTypes: ["code"],
      scopes: ["crm.read", "crm.write", "admin.read", "admin.write", "events.read", "tenant.manage"],
      tenantIds: ["tenant-a"],
      isPublic: false,
      metadata: {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    seededClients: [],
  }) as unknown as AppConfig;

const createStore = async () => {
  const store = new MemoryAppStore();
  const tenantA = {
    id: "tenant-a",
    name: "Tenant A",
    active: true,
    metadata: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const tenantB = {
    id: "tenant-b",
    name: "Tenant B",
    active: true,
    metadata: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await store.saveTenant(tenantA);
  await store.saveTenant(tenantB);
  await store.saveAccount({
    accountId: "local-admin",
    email: "local-admin@example.com",
    name: "Local Admin",
    tenantIds: ["tenant-a"],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await store.saveClientRegistration({
    clientId: "local-dev-client",
    clientName: "Local Dev Client",
    clientSecret: "dev-secret",
    redirectUris: ["http://127.0.0.1:8787/callback"],
    grantTypes: ["authorization_code", "refresh_token", "client_credentials"],
    responseTypes: ["code"],
    scopes: ["crm.read", "crm.write", "admin.read", "admin.write", "events.read", "tenant.manage"],
    tenantIds: ["tenant-a"],
    isPublic: false,
    metadata: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await store.saveClientRegistration({
    clientId: "tenant-b-client",
    clientName: "Tenant B Client",
    clientSecret: "dev-secret-b",
    redirectUris: ["http://127.0.0.1:8788/callback"],
    grantTypes: ["authorization_code"],
    responseTypes: ["code"],
    scopes: ["crm.read"],
    tenantIds: ["tenant-b"],
    isPublic: false,
    metadata: {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await store.saveTenantGrant({
    clientId: "local-dev-client",
    tenantId: "tenant-a",
    scopes: ["crm.read", "crm.write", "admin.read", "admin.write", "events.read", "tenant.manage"],
    isDefault: true,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await store.saveInstallation({
    tenantId: "tenant-a",
    accountId: 11,
    baseDomain: "https://acme.amocrm.ru/nested/path/",
    integrationId: "integration-1",
    clientSecret: "super-secret-client-secret",
    redirectUri: "http://localhost:3456/oauth/amocrm/callback",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    tokens: {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      tokenType: "Bearer",
      expiresAt: "2099-01-01T00:00:00.000Z",
      scopeSnapshot: ["crm.read"],
    },
  });

  return store;
};

const createOidcStub = (authInfo: AuthInfo) =>
  ({
    provider: {} as never,
    callback: vi.fn(async () => undefined),
    verifyAccessToken: vi.fn(async (token: string) => {
      if (token !== "admin-token") {
        throw new AppError("Invalid access token", { statusCode: 401, code: "invalid_token" });
      }
      return authInfo;
    }),
    getClient: vi.fn(),
    buildAuthorizationServerMetadata: vi.fn(() => ({
      issuer: "http://localhost:3456/",
      authorization_endpoint: "http://localhost:3456/auth",
      token_endpoint: "http://localhost:3456/token",
      jwks_uri: "http://localhost:3456/jwks",
    })),
    buildProtectedResourceMetadata: vi.fn(() => ({
      resource: "http://localhost:3456/mcp",
      authorization_servers: ["http://localhost:3456/"],
    })),
  }) as unknown as OidcFacade;

const createAmoStub = () => {
  const installation = {
    tenantId: "tenant-a",
    accountId: 11,
    baseDomain: "https://acme.amocrm.ru/nested/path/",
    integrationId: "integration-1",
    clientSecret: "super-secret-client-secret",
    redirectUri: "http://localhost:3456/oauth/amocrm/callback",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    tokens: {
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      tokenType: "Bearer",
      expiresAt: "2099-01-01T00:00:00.000Z",
      scopeSnapshot: ["crm.read"],
    },
  };

  return {
    exchangeAuthorizationCode: vi.fn(async (tenantId: string, code: string) => ({
      tenantId,
      installation: {
        ...installation,
        tenantId,
        tokens: {
          ...installation.tokens,
          accessToken: `exchange-${code}`,
        },
      },
    })),
    syncWebhookSubscription: vi.fn(),
  } as unknown as AmoCrmClient;
};

const createEventsStub = () =>
  ({
    ingest: vi.fn(async (events) => events),
    list: vi.fn(),
    get: vi.fn(),
    replay: vi.fn(),
  }) as unknown as EventService;

const createAuditStub = () =>
  ({
    recordToolAction: vi.fn(),
  }) as unknown as AuditService;

const createAppContext = async (envOverrides?: Partial<AppConfig["env"]>): Promise<AppContext> => {
  const store = await createStore();
  const authInfo: AuthInfo = {
    token: "admin-token",
    clientId: "local-dev-client",
    scopes: ["admin.read", "tenant.manage", "admin.write"],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    resource: new URL("http://localhost:3456/mcp"),
    extra: {
      tenantIds: ["tenant-a"],
      defaultTenantId: "tenant-a",
      subject: "local-admin",
    },
  };

  return {
    config: createConfig(envOverrides),
    logger,
    store,
    cache: {
      reserveWithinWindow: vi.fn(),
      putIfAbsent: vi.fn(),
      close: vi.fn(),
    },
    oidc: createOidcStub(authInfo),
    amo: createAmoStub(),
    events: createEventsStub(),
    audit: createAuditStub(),
  } as unknown as AppContext;
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("createHttpApp", () => {
  it("requires bearer auth for dashboard and hides request host from the challenge", async () => {
    const app = await createHttpApp(await createAppContext());

    const unauthorized = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: {
        host: "evil.example",
      },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(unauthorized.headers["www-authenticate"]).toBe(
      'Bearer resource_metadata="http://localhost:3456/.well-known/oauth-protected-resource/mcp"',
    );
    expect(String(unauthorized.body)).not.toContain("evil.example");

    const authorized = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: {
        authorization: "Bearer admin-token",
        host: "evil.example",
      },
    });

    expect(authorized.statusCode).toBe(200);
    expect(authorized.body).not.toContain("super-secret-client-secret");
    expect(authorized.body).not.toContain("access-secret");
    expect(authorized.body).not.toContain("refresh-secret");
    expect(authorized.body).toContain("tenant-a");
    expect(authorized.body).not.toContain("tenant-b");
    expect(authorized.body).not.toContain("Tenant B Client");

    await app.close();
  });

  it("returns the bearer challenge for invalid bearer tokens too", async () => {
    const app = await createHttpApp(await createAppContext());

    const response = await app.inject({
      method: "GET",
      url: "/dashboard",
      headers: {
        authorization: "Bearer invalid-token",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.headers["www-authenticate"]).toBe(
      'Bearer resource_metadata="http://localhost:3456/.well-known/oauth-protected-resource/mcp"',
    );

    await app.close();
  });

  it("starts and validates amoCRM install sessions with state binding", async () => {
    const context = await createAppContext();
    const app = await createHttpApp(context);

    const start = await app.inject({
      method: "GET",
      url: "/oauth/amocrm/start?tenantId=tenant-a",
    });

    expect(start.statusCode).toBe(302);
    const startLocation = new URL(start.headers.location as string);
    expect(startLocation.toString()).toContain("https://www.amocrm.ru/oauth");
    expect(startLocation.searchParams.get("client_id")).toBe("integration-1");
    expect(startLocation.searchParams.get("mode")).toBe("post_message");

    const state = startLocation.searchParams.get("state");
    expect(state).toBeTruthy();

    const callback = await app.inject({
      method: "GET",
      url: `/oauth/amocrm/callback?code=auth-code-123&state=${state}`,
    });

    expect(callback.statusCode).toBe(200);
    expect(context.amo.exchangeAuthorizationCode).toHaveBeenCalledWith("tenant-a", "auth-code-123");
    expect(JSON.parse(callback.body)).toMatchObject({
      status: "connected",
      tenantId: "tenant-a",
      baseDomain: "https://acme.amocrm.ru/nested/path/",
    });

    const secondStart = await app.inject({
      method: "GET",
      url: "/oauth/amocrm/start?tenantId=tenant-a",
    });
    const secondState = new URL(secondStart.headers.location as string).searchParams.get("state");
    expect(secondState).toBeTruthy();

    const mismatch = await app.inject({
      method: "GET",
      url: `/oauth/amocrm/callback?code=auth-code-456&state=${secondState}&tenantId=tenant-b`,
    });

    expect(mismatch.statusCode).toBe(400);
    expect(JSON.parse(mismatch.body)).toMatchObject({
      error: "invalid_state",
    });

    const invalid = await app.inject({
      method: "GET",
      url: "/oauth/amocrm/callback?code=auth-code-123&state=missing-state",
    });

    expect(invalid.statusCode).toBe(400);
    expect(JSON.parse(invalid.body)).toMatchObject({
      error: "invalid_state",
    });

    await app.close();
  });

  it("requires admin auth for amoCRM install start when the bind host is not loopback", async () => {
    const app = await createHttpApp(await createAppContext({
      HTTP_BIND_HOST: "0.0.0.0",
    }));

    const unauthenticated = await app.inject({
      method: "GET",
      url: "/oauth/amocrm/start?tenantId=tenant-a",
    });

    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.headers["www-authenticate"]).toBe(
      'Bearer resource_metadata="http://localhost:3456/.well-known/oauth-protected-resource/mcp"',
    );

    const authenticated = await app.inject({
      method: "GET",
      url: "/oauth/amocrm/start?tenantId=tenant-a",
      headers: {
        authorization: "Bearer admin-token",
      },
    });

    expect(authenticated.statusCode).toBe(302);

    await app.close();
  });

  it("enforces tenant binding on admin routes", async () => {
    const app = await createHttpApp(await createAppContext());

    const response = await app.inject({
      method: "GET",
      url: "/admin/tenants/tenant-b/install-status",
      headers: {
        authorization: "Bearer admin-token",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({
      error: "cross_tenant_denied",
    });

    await app.close();
  });

  it("binds webhook ingestion to the matching amoCRM installation", async () => {
    const context = await createAppContext();
    const app = await createHttpApp(context);

    const accepted = await app.inject({
      method: "POST",
      url: "/webhooks/amocrm?token=webhook-secret-123",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload:
        "account[id]=11&account[subdomain]=acme&leads[add][0][id]=42&leads[add][0][updated_at]=1710000000",
    });

    expect(accepted.statusCode).toBe(200);
    expect(JSON.parse(accepted.body)).toMatchObject({
      accepted: 1,
      dropped: 0,
    });
    expect(context.events.ingest).toHaveBeenCalledTimes(1);

    const rejected = await app.inject({
      method: "POST",
      url: "/webhooks/amocrm?token=webhook-secret-123",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload:
        "account[id]=999&account[subdomain]=other&leads[add][0][id]=42&leads[add][0][updated_at]=1710000000",
    });

    expect(rejected.statusCode).toBe(400);
    expect(JSON.parse(rejected.body)).toMatchObject({
      error: "invalid_webhook_source",
    });

    const missingToken = await app.inject({
      method: "POST",
      url: "/webhooks/amocrm",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload:
        "account[id]=11&account[subdomain]=acme&leads[add][0][id]=42&leads[add][0][updated_at]=1710000000",
    });

    expect(missingToken.statusCode).toBe(401);
    expect(JSON.parse(missingToken.body)).toMatchObject({
      error: "invalid_webhook_token",
    });

    await app.close();
  });

  it("redacts webhook tokens from sync responses and error logs", async () => {
    const context = await createAppContext();
    context.amo.syncWebhookSubscription = vi.fn(async () => ({
      status: 200,
      data: { ok: true },
      headers: new Headers(),
    })) as unknown as AmoCrmClient["syncWebhookSubscription"];

    const app = await createHttpApp(context);

    const sync = await app.inject({
      method: "POST",
      url: "/admin/tenants/tenant-a/webhooks/sync",
      headers: {
        authorization: "Bearer admin-token",
      },
      payload: {},
    });

    expect(sync.statusCode).toBe(200);
    expect(sync.body).toContain("/webhooks/amocrm?token=%5Bredacted%5D");
    expect(sync.body).not.toContain("webhook-secret-123");

    await app.inject({
      method: "POST",
      url: "/webhooks/amocrm?token=webhook-secret-123",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      payload:
        "account[id]=999&account[subdomain]=other&leads[add][0][id]=42&leads[add][0][updated_at]=1710000000",
    });

    const logCall = logger.error.mock.calls.at(-1);
    expect(logCall?.[0]?.url).toContain("token=%5Bredacted%5D");
    expect(logCall?.[0]?.url).not.toContain("webhook-secret-123");

    await app.close();
  });

  it("keeps /authorize aligned with the actual auth endpoint", async () => {
    const app = await createHttpApp(await createAppContext());

    const response = await app.inject({
      method: "GET",
      url: "/authorize?foo=bar",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/auth?foo=bar");

    await app.close();
  });
});
