import type {
  AmoApiRequest,
  AmoApiResponse,
  AmoInstallation,
  AmoOAuthCallbackResult,
  AmoTokenExchangeResponse,
  AmoWebhookParseResult,
  AppStore,
  CacheAdapter,
} from "../types.js";
import { AppError, ensure } from "../utils/errors.js";
import { addSeconds, nowIso, sleep } from "../utils/time.js";

const normalizeBaseDomain = (input: string): string => input.replace(/^https?:\/\//, "").replace(/\/+$/, "");

const buildUrl = (
  baseDomain: string,
  path: string,
  query?: Record<string, string | number | boolean | undefined>,
): string => {
  const url = new URL(`https://${normalizeBaseDomain(baseDomain)}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== "undefined") {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
};

class AmoRateLimiter {
  constructor(private readonly cache: CacheAdapter) {}

  async waitTurn(tenantId: string): Promise<void> {
    const integrationWait = await this.cache.reserveWithinWindow(`amo:${tenantId}:integration`, 7, 1000);
    const accountWait = await this.cache.reserveWithinWindow(`amo:${tenantId}:account`, 50, 1000);
    const waitMs = Math.max(integrationWait, accountWait);
    if (waitMs > 0) {
      await sleep(waitMs + 10);
    }
  }
}

export class AmoCrmClient {
  private readonly limiter: AmoRateLimiter;

  constructor(
    private readonly store: AppStore,
    cache: CacheAdapter,
    private readonly redirectUri: string,
  ) {
    this.limiter = new AmoRateLimiter(cache);
  }

  async exchangeAuthorizationCode(tenantId: string, code: string): Promise<AmoOAuthCallbackResult> {
    const installation = await this.store.getInstallation(tenantId);
    ensure(installation, `No amoCRM installation found for tenant ${tenantId}`, {
      statusCode: 400,
      code: "missing_installation",
    });

    const tokens = await this.exchangeTokenRequest(installation, {
      client_id: installation.integrationId,
      client_secret: installation.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: installation.redirectUri,
    });

    const nextInstallation: AmoInstallation = {
      ...installation,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type,
        expiresAt: addSeconds(new Date(), tokens.expires_in).toISOString(),
        scopeSnapshot: [],
        serverTime: tokens.server_time,
      },
      updatedAt: nowIso(),
    };

    await this.store.saveInstallation(nextInstallation);
    return {
      tenantId,
      installation: nextInstallation,
    };
  }

  async refreshTokens(tenantId: string): Promise<AmoInstallation> {
    const installation = await this.store.getInstallation(tenantId);
    ensure(installation?.tokens?.refreshToken, `No refresh token available for tenant ${tenantId}`, {
      statusCode: 400,
      code: "missing_refresh_token",
    });

    const tokens = await this.exchangeTokenRequest(installation, {
      client_id: installation.integrationId,
      client_secret: installation.clientSecret,
      grant_type: "refresh_token",
      refresh_token: installation.tokens.refreshToken,
      redirect_uri: installation.redirectUri,
    });

    const nextInstallation: AmoInstallation = {
      ...installation,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenType: tokens.token_type,
        expiresAt: addSeconds(new Date(), tokens.expires_in).toISOString(),
        scopeSnapshot: installation.tokens?.scopeSnapshot ?? [],
        serverTime: tokens.server_time,
      },
      updatedAt: nowIso(),
    };

    await this.store.saveInstallation(nextInstallation);
    return nextInstallation;
  }

  async ensureValidInstallation(tenantId: string): Promise<AmoInstallation> {
    const installation = await this.store.getInstallation(tenantId);
    ensure(installation, `No amoCRM installation for tenant ${tenantId}`, {
      statusCode: 400,
      code: "missing_installation",
    });

    if (!installation.tokens) {
      return installation;
    }

    const expiresAt = new Date(installation.tokens.expiresAt).getTime();
    if (expiresAt - Date.now() < 60_000) {
      return await this.refreshTokens(tenantId);
    }

    return installation;
  }

  async request<T = unknown>(request: AmoApiRequest): Promise<AmoApiResponse<T>> {
    let installation = await this.ensureValidInstallation(request.tenantId);
    ensure(installation.tokens?.accessToken, `No access token for tenant ${request.tenantId}`, {
      statusCode: 400,
      code: "missing_access_token",
    });
    let accessToken = installation.tokens.accessToken;

    let attempt = 0;

    while (attempt < 3) {
      attempt += 1;
      await this.limiter.waitTurn(request.tenantId);

      const response = await fetch(buildUrl(installation.baseDomain, request.path, request.query), {
        method: request.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: typeof request.body === "undefined" ? undefined : JSON.stringify(request.body),
      });

      if (response.status === 401 && attempt === 1) {
        installation = await this.refreshTokens(request.tenantId);
        ensure(installation.tokens?.accessToken, `No access token for tenant ${request.tenantId}`, {
          statusCode: 400,
          code: "missing_access_token",
        });
        accessToken = installation.tokens.accessToken;
        continue;
      }

      if (response.status === 429 && attempt < 3) {
        await sleep(250 * attempt);
        continue;
      }

      const text = await response.text();
      const data = text.length ? (JSON.parse(text) as T) : ({} as T);

      if (!response.ok) {
        throw new AppError(`amoCRM request failed with status ${response.status}`, {
          statusCode: response.status >= 500 ? 502 : response.status,
          code: response.status === 429 ? "rate_limit" : response.status === 401 ? "auth" : "upstream_error",
          details: {
            status: response.status,
            body: data,
            path: request.path,
          },
        });
      }

      return {
        status: response.status,
        data,
        headers: response.headers,
      };
    }

    throw new AppError("amoCRM request retry limit exceeded", { statusCode: 502, code: "upstream_unavailable" });
  }

  async getEntity(tenantId: string, collection: string, entityId?: string, query?: Record<string, string | number | boolean | undefined>) {
    const path = entityId ? `/api/v4/${collection}/${entityId}` : `/api/v4/${collection}`;
    return await this.request({
      tenantId,
      method: "GET",
      path,
      query,
    });
  }

  async getAccount(tenantId: string) {
    return await this.request({
      tenantId,
      method: "GET",
      path: "/api/v4/account",
      query: {
        with: "users,pipelines,groups,task_types,loss_reasons",
      },
    });
  }

  async upsertCollection(tenantId: string, collection: string, payload: unknown[], method: "POST" | "PATCH" = "POST") {
    return await this.request({
      tenantId,
      method,
      path: `/api/v4/${collection}`,
      body: payload,
    });
  }

  async completeTask(tenantId: string, taskId: string, text?: string) {
    return await this.request({
      tenantId,
      method: "PATCH",
      path: `/api/v4/tasks/${taskId}`,
      body: [
        {
          id: Number(taskId),
          is_completed: true,
          text,
        },
      ],
    });
  }

  async addNote(tenantId: string, entityType: string, entityId: string, noteType: string, params: Record<string, unknown>) {
    return await this.request({
      tenantId,
      method: "POST",
      path: `/api/v4/${entityType}/${entityId}/notes`,
      body: [
        {
          note_type: noteType,
          params,
        },
      ],
    });
  }

  async setTags(tenantId: string, entityType: string, entityId: string, tags: string[]) {
    return await this.request({
      tenantId,
      method: "PATCH",
      path: `/api/v4/${entityType}`,
      body: [
        {
          id: Number(entityId),
          _embedded: {
            tags: tags.map((name) => ({ name })),
          },
        },
      ],
    });
  }

  async linkEntities(tenantId: string, entityType: string, entityId: string, links: Array<{ toEntityType: string; toEntityId: string }>) {
    return await this.request({
      tenantId,
      method: "POST",
      path: `/api/v4/${entityType}/${entityId}/link`,
      body: links.map((link) => ({
        to_entity_type: link.toEntityType,
        to_entity_id: Number(link.toEntityId),
      })),
    });
  }

  async rawRequest(tenantId: string, method: AmoApiRequest["method"], path: string, body?: unknown, query?: Record<string, string | number | boolean | undefined>) {
    return await this.request({
      tenantId,
      method,
      path,
      body,
      query,
    });
  }

  async syncWebhookSubscription(tenantId: string, destinationUrl: string) {
    return await this.request({
      tenantId,
      method: "POST",
      path: "/api/v4/webhooks",
      body: [
        {
          destination: destinationUrl,
          settings: ["add_lead", "update_lead", "add_contact", "update_contact", "add_company", "update_company", "add_task", "update_task"],
        },
      ],
    });
  }

  private async exchangeTokenRequest(installation: AmoInstallation, body: Record<string, unknown>): Promise<AmoTokenExchangeResponse> {
    const response = await fetch(`https://${normalizeBaseDomain(installation.baseDomain)}/oauth2/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as AmoTokenExchangeResponse;
    if (!response.ok) {
      throw new AppError("amoCRM OAuth exchange failed", {
        statusCode: response.status >= 500 ? 502 : response.status,
        code: "amo_oauth_error",
        details: {
          response: data,
        },
      });
    }

    return data;
  }
}
