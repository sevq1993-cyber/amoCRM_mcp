import type {
  AmoApiRequest,
  AmoApiResponse,
  AmoInstallation,
  AmoOAuthCallbackResult,
  AmoTokenExchangeResponse,
  AppStore,
  CacheAdapter,
} from "../types.js";
import { AppError, ensure } from "../utils/errors.js";
import { addSeconds, nowIso, sleep } from "../utils/time.js";
import { z } from "zod";

type QueryParams = Record<string, string | number | boolean | undefined>;
type CollectionName = "leads" | "contacts" | "companies" | "tasks" | "users" | "notes";
type WriteMethod = "POST" | "PATCH" | "DELETE";

const amoTokenExchangeResponseSchema = z.object({
  token_type: z.string().min(1),
  expires_in: z.number().int().positive(),
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  server_time: z.number().int().optional(),
});

const normalizeBaseDomain = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AppError("amoCRM base domain is empty", {
      statusCode: 400,
      code: "invalid_base_domain",
    });
  }

  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).host;
    }
  } catch {
    // fall through to string cleanup below
  }

  return trimmed.replace(/^https?:\/\//, "").replace(/\/+$/, "").split("/")[0] ?? trimmed;
};

const buildApiUrl = (baseDomain: string, path: string, query?: QueryParams): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(normalizedPath, `https://${normalizeBaseDomain(baseDomain)}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value !== "undefined") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
};

const parseRetryAfterMs = (value: string | null): number | undefined => {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(Math.ceil(seconds * 1000), 0);
  }

  const target = Date.parse(value);
  if (Number.isFinite(target)) {
    return Math.max(target - Date.now(), 0);
  }

  return undefined;
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const looksJson =
    contentType.includes("application/json") ||
    contentType.includes("+json") ||
    text.startsWith("{") ||
    text.startsWith("[");

  if (!looksJson) {
    return text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const buildUpstreamError = (status: number, path: string, body: unknown): AppError => {
  const code =
    status === 429
      ? "rate_limit"
      : status === 401
        ? "auth"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not_found"
            : status === 400 || status === 422
              ? "validation_error"
              : "upstream_error";

  return new AppError(`amoCRM request failed with status ${status}`, {
    statusCode: status >= 500 ? 502 : status,
    code,
    details: {
      status,
      path,
      body,
    },
  });
};

const parseTokenExchangeResponse = (body: unknown): AmoTokenExchangeResponse => {
  const parsed = amoTokenExchangeResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("amoCRM OAuth response has an unexpected shape", {
      statusCode: 502,
      code: "invalid_oauth_response",
      details: {
        body,
        issues: parsed.error.issues,
      },
    });
  }

  return parsed.data;
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
      redirect_uri: installation.redirectUri || this.redirectUri,
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
      redirect_uri: installation.redirectUri || this.redirectUri,
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
    if (request.requiresConfirm) {
      throw new AppError("Confirmation is required before executing this amoCRM request", {
        statusCode: 400,
        code: "confirmation_required",
        details: {
          method: request.method,
          path: request.path,
        },
      });
    }

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

      const response = await fetch(buildApiUrl(installation.baseDomain, request.path, request.query), {
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
        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
        const backoff = retryAfter ?? 250 * attempt;
        await sleep(backoff);
        continue;
      }

      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw buildUpstreamError(response.status, request.path, data);
      }

      return {
        status: response.status,
        data: data as T,
        headers: response.headers,
      };
    }

    throw new AppError("amoCRM request retry limit exceeded", {
      statusCode: 502,
      code: "upstream_unavailable",
      details: {
        path: request.path,
        tenantId: request.tenantId,
      },
    });
  }

  async listCollection(
    tenantId: string,
    collection: CollectionName,
    query?: QueryParams,
  ): Promise<AmoApiResponse<unknown>> {
    return await this.request({
      tenantId,
      method: "GET",
      path: `/api/v4/${collection}`,
      query,
    });
  }

  async getCollectionItem(
    tenantId: string,
    collection: CollectionName,
    entityId: string,
    query?: QueryParams,
  ): Promise<AmoApiResponse<unknown>> {
    return await this.request({
      tenantId,
      method: "GET",
      path: `/api/v4/${collection}/${entityId}`,
      query,
    });
  }

  async getEntity(
    tenantId: string,
    collection: string,
    entityId?: string,
    query?: QueryParams,
  ): Promise<AmoApiResponse<unknown>> {
    if (entityId) {
      return await this.request({
        tenantId,
        method: "GET",
        path: `/api/v4/${collection}/${entityId}`,
        query,
      });
    }

    return await this.request({
      tenantId,
      method: "GET",
      path: `/api/v4/${collection}`,
      query,
    });
  }

  async createCollectionItems(
    tenantId: string,
    collection: CollectionName,
    payload: unknown[],
  ): Promise<AmoApiResponse<unknown>> {
    return await this.request({
      tenantId,
      method: "POST",
      path: `/api/v4/${collection}`,
      body: payload,
    });
  }

  async updateCollectionItems(
    tenantId: string,
    collection: CollectionName,
    payload: unknown[],
  ): Promise<AmoApiResponse<unknown>> {
    return await this.request({
      tenantId,
      method: "PATCH",
      path: `/api/v4/${collection}`,
      body: payload,
    });
  }

  async upsertCollection(
    tenantId: string,
    collection: CollectionName,
    payload: unknown[],
    method: "POST" | "PATCH" = "POST",
  ): Promise<AmoApiResponse<unknown>> {
    return method === "POST"
      ? await this.createCollectionItems(tenantId, collection, payload)
      : await this.updateCollectionItems(tenantId, collection, payload);
  }

  async getAccount(tenantId: string): Promise<AmoApiResponse<unknown>> {
    return await this.request({
      tenantId,
      method: "GET",
      path: "/api/v4/account",
      query: {
        with: "users,pipelines,groups,task_types,loss_reasons",
      },
    });
  }

  async listLeads(tenantId: string, query?: QueryParams): Promise<AmoApiResponse<unknown>> {
    return await this.listCollection(tenantId, "leads", query);
  }

  async getLead(tenantId: string, leadId: string, query?: QueryParams): Promise<AmoApiResponse<unknown>> {
    return await this.getCollectionItem(tenantId, "leads", leadId, query);
  }

  async createLeads(tenantId: string, payload: unknown[]): Promise<AmoApiResponse<unknown>> {
    return await this.createCollectionItems(tenantId, "leads", payload);
  }

  async updateLeads(tenantId: string, payload: unknown[]): Promise<AmoApiResponse<unknown>> {
    return await this.updateCollectionItems(tenantId, "leads", payload);
  }

  async listContacts(tenantId: string, query?: QueryParams): Promise<AmoApiResponse<unknown>> {
    return await this.listCollection(tenantId, "contacts", query);
  }

  async getContact(tenantId: string, contactId: string, query?: QueryParams): Promise<AmoApiResponse<unknown>> {
    return await this.getCollectionItem(tenantId, "contacts", contactId, query);
  }

  async createContacts(tenantId: string, payload: unknown[]): Promise<AmoApiResponse<unknown>> {
    return await this.createCollectionItems(tenantId, "contacts", payload);
  }

  async updateContacts(tenantId: string, payload: unknown[]): Promise<AmoApiResponse<unknown>> {
    return await this.updateCollectionItems(tenantId, "contacts", payload);
  }

  async listCompanies(tenantId: string, query?: QueryParams): Promise<AmoApiResponse<unknown>> {
    return await this.listCollection(tenantId, "companies", query);
  }

  async getCompany(tenantId: string, companyId: string, query?: QueryParams): Promise<AmoApiResponse<unknown>> {
    return await this.getCollectionItem(tenantId, "companies", companyId, query);
  }

  async createCompanies(tenantId: string, payload: unknown[]): Promise<AmoApiResponse<unknown>> {
    return await this.createCollectionItems(tenantId, "companies", payload);
  }

  async updateCompanies(tenantId: string, payload: unknown[]): Promise<AmoApiResponse<unknown>> {
    return await this.updateCollectionItems(tenantId, "companies", payload);
  }

  async listTasks(tenantId: string, query?: QueryParams): Promise<AmoApiResponse<unknown>> {
    return await this.listCollection(tenantId, "tasks", query);
  }

  async getTask(tenantId: string, taskId: string, query?: QueryParams): Promise<AmoApiResponse<unknown>> {
    return await this.getCollectionItem(tenantId, "tasks", taskId, query);
  }

  async createTasks(tenantId: string, payload: unknown[]): Promise<AmoApiResponse<unknown>> {
    return await this.createCollectionItems(tenantId, "tasks", payload);
  }

  async updateTasks(tenantId: string, payload: unknown[]): Promise<AmoApiResponse<unknown>> {
    return await this.updateCollectionItems(tenantId, "tasks", payload);
  }

  async completeTask(tenantId: string, taskId: string, text?: string): Promise<AmoApiResponse<unknown>> {
    const numericTaskId = Number(taskId);
    ensure(Number.isFinite(numericTaskId), `Invalid task id: ${taskId}`, {
      statusCode: 400,
      code: "validation_error",
    });

    return await this.request({
      tenantId,
      method: "PATCH",
      path: `/api/v4/tasks/${taskId}`,
      body: {
        id: numericTaskId,
        is_completed: true,
        text,
      },
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

  async linkEntities(
    tenantId: string,
    entityType: string,
    entityId: string,
    links: Array<{ toEntityType: string; toEntityId: string }>,
  ) {
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

  async rawRequest(
    tenantId: string,
    method: AmoApiRequest["method"],
    path: string,
    body?: unknown,
    query?: QueryParams,
  ) {
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
      body: {
        destination: destinationUrl,
        settings: ["add_lead", "update_lead", "add_contact", "update_contact", "add_company", "update_company", "add_task", "update_task"],
      },
    });
  }

  private async exchangeTokenRequest(
    installation: AmoInstallation,
    body: Record<string, unknown>,
  ): Promise<AmoTokenExchangeResponse> {
    const response = await fetch(`https://${normalizeBaseDomain(installation.baseDomain)}/oauth2/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const data = await parseResponseBody(response);
      throw new AppError("amoCRM OAuth exchange failed", {
        statusCode: response.status >= 500 ? 502 : response.status,
        code: "amo_oauth_error",
        details: {
          response: data,
        },
      });
    }

    const data = await parseResponseBody(response);
    return parseTokenExchangeResponse(data);
  }
}
