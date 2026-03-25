import { afterEach, describe, expect, it, vi } from "vitest";
import { AmoCrmClient } from "./client.js";
import { MemoryAppStore } from "../persistence/memory-store.js";
import { MemoryCacheAdapter } from "../persistence/cache.js";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

const baseInstallation = {
  tenantId: "tenant-1",
  accountId: 11,
  baseDomain: "https://subdomain.amocrm.ru/nested/path/",
  integrationId: "integration-1",
  clientSecret: "secret-1",
  redirectUri: "",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  tokens: {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    tokenType: "Bearer",
    expiresAt: "2099-01-01T00:00:00.000Z",
    scopeSnapshot: ["crm.read"],
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AmoCrmClient", () => {
  it("normalizes base domain and exposes collection helpers", async () => {
    const store = new MemoryAppStore();
    await store.saveInstallation(baseInstallation);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        "https://subdomain.amocrm.ru/api/v4/account?with=users%2Cpipelines%2Cgroups%2Ctask_types%2Closs_reasons",
      );
      return jsonResponse({ ok: true }, { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    const result = await client.getAccount("tenant-1");

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await store.getInstallation("tenant-1")).toMatchObject({
      tokens: {
        accessToken: "access-1",
      },
    });
  });

  it("refreshes tokens once after 401 and retries the request", async () => {
    const store = new MemoryAppStore();
    await store.saveInstallation(baseInstallation);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/oauth2/access_token")) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(
          JSON.stringify({
            client_id: "integration-1",
            client_secret: "secret-1",
            grant_type: "refresh_token",
            refresh_token: "refresh-1",
            redirect_uri: "http://localhost:3000/oauth/amocrm/callback",
          }),
        );

        return jsonResponse(
          {
            access_token: "access-2",
            refresh_token: "refresh-2",
            token_type: "Bearer",
            expires_in: 3600,
            server_time: 123,
          },
          { status: 200 },
        );
      }

      if (url.includes("/api/v4/leads")) {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
        if (auth === "Bearer access-1") {
          return jsonResponse({ error: "expired" }, { status: 401 });
        }

        expect(auth).toBe("Bearer access-2");
        return jsonResponse({ collection: [] }, { status: 200 });
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    const result = await client.listLeads("tenant-1");

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const updated = await store.getInstallation("tenant-1");
    expect(updated?.tokens?.accessToken).toBe("access-2");
    expect(updated?.tokens?.refreshToken).toBe("refresh-2");
  });

  it("backs off and retries on 429 using Retry-After when available", async () => {
    vi.useFakeTimers();

    const store = new MemoryAppStore();
    await store.saveInstallation(baseInstallation);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v4/tasks")) {
        if (fetchMock.mock.calls.length === 1) {
          return jsonResponse({ error: "slow down" }, { status: 429, headers: { "retry-after": "1" } });
        }

        return jsonResponse({ items: [{ id: 1 }] }, { status: 200 });
      }

      return jsonResponse({ error: "unexpected" }, { status: 500 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    const promise = client.listTasks("tenant-1");

    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exposes write helpers with stable paths", async () => {
    const store = new MemoryAppStore();
    await store.saveInstallation(baseInstallation);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://subdomain.amocrm.ru/api/v4/contacts");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify([{ name: "John Doe" }]));
      return jsonResponse([{ id: 123 }], { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    const result = await client.createContacts("tenant-1", [{ name: "John Doe" }]);

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serializes completeTask as a single task payload", async () => {
    const store = new MemoryAppStore();
    await store.saveInstallation(baseInstallation);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://subdomain.amocrm.ru/api/v4/tasks/42");
      expect(init?.method).toBe("PATCH");
      expect(init?.body).toBe(JSON.stringify({ id: 42, is_completed: true, text: "Done" }));
      return jsonResponse({ id: 42 }, { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    const result = await client.completeTask("tenant-1", "42", "Done");

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serializes webhook sync as a single webhook payload", async () => {
    const store = new MemoryAppStore();
    await store.saveInstallation(baseInstallation);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url).toBe("https://subdomain.amocrm.ru/api/v4/webhooks");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(
        JSON.stringify({
          destination: "https://example.com/webhooks/amocrm",
          settings: [
            "add_lead",
            "update_lead",
            "add_contact",
            "update_contact",
            "add_company",
            "update_company",
            "add_task",
            "update_task",
          ],
        }),
      );
      return jsonResponse({ id: 1 }, { status: 200 });
    });

    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    const result = await client.syncWebhookSubscription("tenant-1", "https://example.com/webhooks/amocrm");

    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects confirmation-gated low-level requests before sending them upstream", async () => {
    const store = new MemoryAppStore();
    await store.saveInstallation(baseInstallation);
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    await expect(
      client.request({
        tenantId: "tenant-1",
        method: "DELETE",
        path: "/api/v4/leads/1",
        requiresConfirm: true,
      }),
    ).rejects.toMatchObject({
      code: "confirmation_required",
      statusCode: 400,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed oauth token responses before persisting installation state", async () => {
    const store = new MemoryAppStore();
    await store.saveInstallation({
      ...baseInstallation,
      tokens: undefined,
    });

    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          access_token: "access-2",
          token_type: "Bearer",
          expires_in: 3600,
        },
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    await expect(client.exchangeAuthorizationCode("tenant-1", "code-1")).rejects.toMatchObject({
      code: "invalid_oauth_response",
      statusCode: 502,
    });

    const persisted = await store.getInstallation("tenant-1");
    expect(persisted?.tokens).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [403, "forbidden"],
    [404, "not_found"],
    [422, "validation_error"],
  ])("maps amoCRM %s errors to stable client codes", async (status, code) => {
    const store = new MemoryAppStore();
    await store.saveInstallation(baseInstallation);

    const fetchMock = vi.fn(async () => jsonResponse({ error: code }, { status }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new AmoCrmClient(store, new MemoryCacheAdapter(), "http://localhost:3000/oauth/amocrm/callback");
    await expect(client.listLeads("tenant-1")).rejects.toMatchObject({
      code,
      statusCode: status,
      details: {
        status,
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
