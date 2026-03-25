import { Provider } from "oidc-provider";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { AppConfig } from "../config.js";
import type { AppStore, McpClientRegistration, Scope } from "../types.js";
import { AppError, ensure } from "../utils/errors.js";

type OidcClient = {
  client_id: string;
  client_secret?: string;
  client_name: string;
  redirect_uris: string[];
  response_types: string[];
  grant_types: string[];
  scope: string;
  token_endpoint_auth_method: "none" | "client_secret_post";
};

export interface McpAuthContext {
  clientId: string;
  subject?: string;
  tenantIds: string[];
  defaultTenantId?: string;
  scopes: Scope[];
  resource?: URL;
  expiresAt: number;
}

export interface OidcFacade {
  provider: Provider;
  callback: ReturnType<Provider["callback"]>;
  verifyAccessToken(token: string): Promise<AuthInfo>;
  getClient(clientId: string): Promise<McpClientRegistration | undefined>;
  buildAuthorizationServerMetadata(): Record<string, unknown>;
  buildProtectedResourceMetadata(): Record<string, unknown>;
}

const supportedScopes: Scope[] = [
  "crm.read",
  "crm.write",
  "admin.read",
  "admin.write",
  "events.read",
  "tenant.manage",
];

const uniq = <T>(values: T[]) => [...new Set(values)];

export const extractBearerToken = (authorizationHeader?: string): string | undefined => {
  if (!authorizationHeader) {
    return undefined;
  }

  const [scheme, token, ...rest] = authorizationHeader.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer" || !token || rest.length > 0) {
    return undefined;
  }

  return token;
};

export const createBearerChallenge = (resourceMetadataUrl: string, scope?: string) => {
  const parts = [`Bearer resource_metadata="${resourceMetadataUrl}"`];
  if (scope) {
    parts.push(`scope="${scope}"`);
  }
  return parts.join(", ");
};

export const createAuthorizationServerMetadata = (config: Pick<AppConfig, "issuerUrl" | "baseUrl">) => ({
  issuer: config.issuerUrl.toString(),
  authorization_endpoint: new URL("/auth", config.baseUrl).toString(),
  token_endpoint: new URL("/token", config.baseUrl).toString(),
  jwks_uri: new URL("/jwks", config.baseUrl).toString(),
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token", "client_credentials"],
  token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
  code_challenge_methods_supported: ["S256"],
  scopes_supported: supportedScopes,
});

export const createProtectedResourceMetadata = (config: Pick<AppConfig, "issuerUrl" | "mcpUrl">) => ({
  resource: config.mcpUrl.toString(),
  authorization_servers: [config.issuerUrl.toString()],
  scopes_supported: supportedScopes,
  resource_name: "amoCRM MCP Resource Server",
});

export const resolveMcpAuthContext = (
  authInfo: AuthInfo,
  client: McpClientRegistration,
  resourceUrl: URL,
): McpAuthContext => {
  const tenantIds = uniq([
    ...((authInfo.extra?.tenantIds as string[] | undefined) ?? []),
    ...client.tenantIds,
  ]).filter((value): value is string => typeof value === "string" && value.length > 0);

  const defaultTenantId =
    (typeof authInfo.extra?.defaultTenantId === "string" && authInfo.extra.defaultTenantId) ||
    client.tenantIds[0];

  const scopes = (authInfo.scopes.length > 0 ? authInfo.scopes : client.scopes).filter(
    (scope): scope is Scope => supportedScopes.includes(scope as Scope),
  ) as Scope[];

  return {
    clientId: client.clientId,
    subject: typeof authInfo.extra?.subject === "string" ? authInfo.extra.subject : undefined,
    tenantIds,
    defaultTenantId,
    scopes,
    resource: resourceUrl,
    expiresAt: authInfo.expiresAt ?? 0,
  };
};

const clientToProvider = (client: McpClientRegistration): OidcClient => ({
  client_id: client.clientId,
  client_secret: client.clientSecret,
  client_name: client.clientName,
  redirect_uris: client.redirectUris,
  response_types: client.responseTypes,
  grant_types: client.grantTypes,
  scope: client.scopes.join(" "),
  token_endpoint_auth_method: client.isPublic ? "none" : "client_secret_post",
});

const normalizeAudience = (aud: unknown): URL | undefined => {
  if (typeof aud === "string" && aud.length > 0) {
    return new URL(aud);
  }

  if (Array.isArray(aud) && typeof aud[0] === "string") {
    return new URL(aud[0]);
  }

  return undefined;
};

export const createOidcFacade = async (store: AppStore, config: AppConfig): Promise<OidcFacade> => {
  const registeredClients = await store.listClientRegistrations();

  const provider = new Provider(config.issuerUrl.toString(), {
    clients: registeredClients.map(clientToProvider),
    features: {
      clientCredentials: { enabled: true },
      devInteractions: { enabled: config.env.OIDC_DEV_INTERACTIONS },
      introspection: { enabled: false },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        defaultResource: async () => config.mcpUrl.toString(),
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx: unknown, resourceIndicator: string) => {
          ensure(
            resourceIndicator === config.mcpUrl.toString(),
            `Unsupported resource indicator: ${resourceIndicator}`,
            { statusCode: 400, code: "invalid_target" },
          );

          return {
            scope: "crm.read crm.write admin.read admin.write events.read tenant.manage",
            audience: config.mcpUrl.toString(),
            accessTokenTTL: 60 * 60,
          };
        },
      },
    },
    ttl: {
      AccessToken: 60 * 60,
      AuthorizationCode: 10 * 60,
      ClientCredentials: 60 * 60,
      RefreshToken: 30 * 24 * 60 * 60,
      Session: 24 * 60 * 60,
      Interaction: 60 * 60,
      Grant: 30 * 24 * 60 * 60,
    },
    cookies: {
      keys: ["amocrm-mcp-local-key-1", "amocrm-mcp-local-key-2"],
    },
    pkce: {
      required: () => true,
      methods: ["S256"],
    },
    scopes: ["openid", "offline_access"],
    claims: {
      openid: ["sub"],
      profile: ["name"],
      email: ["email"],
    },
    async findAccount(_ctx: unknown, sub: string) {
      const account = await store.getAccount(sub);
      if (!account) {
        return undefined;
      }

      return {
        accountId: account.accountId,
        async claims(_use: unknown, scope: string) {
          const claims: Record<string, unknown> = {
            sub: account.accountId,
            name: account.name,
          };

          if (scope.includes("email")) {
            claims.email = account.email;
          }

          return claims;
        },
      };
    },
  });

  return {
    provider,
    callback: provider.callback(),
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const accessToken = (await provider.AccessToken.find(token)) ?? (await provider.ClientCredentials.find(token));
      if (!accessToken) {
        throw new AppError("Invalid access token", { statusCode: 401, code: "invalid_token" });
      }

      const client = await store.getClientRegistration(accessToken.clientId as string);
      ensure(client, `Unknown client: ${String(accessToken.clientId)}`, { statusCode: 401, code: "invalid_client" });
      const audience = normalizeAudience(accessToken.aud);
      ensure(
        audience?.toString() === config.mcpUrl.toString(),
        "Access token is not issued for this MCP resource",
        { statusCode: 401, code: "invalid_token" },
      );

      const exp = typeof accessToken.exp === "number" ? accessToken.exp : 0;
      ensure(exp > Math.floor(Date.now() / 1000), "Access token has expired", {
        statusCode: 401,
        code: "invalid_token",
      });

      const grants = await store.listTenantGrants(client.clientId);
      const tenantIds = uniq([
        ...grants.map((grant) => grant.tenantId),
        ...client.tenantIds,
      ]).filter((tenantId): tenantId is string => typeof tenantId === "string" && tenantId.length > 0);
      if (tenantIds.length === 0) {
        tenantIds.push(config.env.DEFAULT_TENANT_ID);
      }

      const scopes = typeof accessToken.scope === "string" && accessToken.scope.length > 0
        ? (accessToken.scope.split(" ").filter(Boolean) as Scope[])
        : client.scopes;
      ensure(
        scopes.every((scope) => supportedScopes.includes(scope)),
        "Access token contains unsupported scopes",
        { statusCode: 401, code: "invalid_token" },
      );

      const authContext = resolveMcpAuthContext(
        {
          token,
          clientId: client.clientId,
          scopes,
          expiresAt: exp,
          resource: audience,
          extra: {
            tenantIds,
            defaultTenantId: grants.find((grant) => grant.isDefault)?.tenantId ?? client.tenantIds[0],
            subject: accessToken.accountId,
          },
        },
        client,
        config.mcpUrl,
      );

      return {
        token,
        clientId: authContext.clientId,
        scopes: authContext.scopes,
        expiresAt: authContext.expiresAt,
        resource: authContext.resource,
        extra: {
          tenantIds: authContext.tenantIds,
          defaultTenantId: authContext.defaultTenantId,
          subject: authContext.subject,
        },
      };
    },
    async getClient(clientId: string) {
      return await store.getClientRegistration(clientId);
    },
    buildAuthorizationServerMetadata() {
      return createAuthorizationServerMetadata(config);
    },
    buildProtectedResourceMetadata() {
      return createProtectedResourceMetadata(config);
    },
  };
};
