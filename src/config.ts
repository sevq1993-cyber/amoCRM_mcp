import { z } from "zod";
import { ALL_SCOPES, type GrantType, type McpClientRegistration, type Scope } from "./types.js";
import { nowIso } from "./utils/time.js";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().optional(),
  PORT: z.coerce.number().default(3000),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  MCP_HTTP_PATH: z.string().default("/mcp"),
  DEFAULT_TENANT_ID: z.string().default("local-default"),
  DEFAULT_TENANT_NAME: z.string().default("Local Default Tenant"),
  LOCAL_ADMIN_ACCOUNT_ID: z.string().default("local-admin"),
  LOCAL_ADMIN_EMAIL: z.string().email().default("local-admin@example.com"),
  LOCAL_ADMIN_NAME: z.string().default("Local Admin"),
  OIDC_DEV_INTERACTIONS: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  AMO_INTEGRATION_ID: z.string().default("replace-me"),
  AMO_CLIENT_SECRET: z.string().default("replace-me"),
  AMO_REDIRECT_URI: z.string().optional(),
  AMO_BASE_DOMAIN: z.string().default("example.amocrm.ru"),
  AMO_ACCOUNT_ID: z.coerce.number().optional(),
  MCP_CLIENTS_JSON: z.string().optional(),
  POSTGRES_URL: z.string().optional(),
  REDIS_URL: z.string().optional(),
  ENABLE_ADMIN_WRITE_TOOLS: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  ENABLE_DELETE_TOOLS: z
    .string()
    .optional()
    .transform((value) => value === "true"),
  ENABLE_WEBHOOK_MUTATIONS: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  LOCAL_DEV_CLIENT_ID: z.string().default("local-dev-client"),
  LOCAL_DEV_CLIENT_SECRET: z.string().default("local-dev-secret"),
  LOCAL_DEV_REDIRECT_URI: z.string().url().default("http://127.0.0.1:8787/callback"),
});

const parseScopes = (value: unknown, fallback: Scope[]): Scope[] => {
  if (!value) {
    return fallback;
  }

  if (Array.isArray(value)) {
    return value as Scope[];
  }

  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean) as Scope[];
  }

  return fallback;
};

const normalizeClient = (raw: Partial<McpClientRegistration>, defaultTenantId: string): McpClientRegistration => {
  const createdAt = raw.createdAt ?? nowIso();
  const updatedAt = raw.updatedAt ?? createdAt;
  const scopes = parseScopes(raw.scopes, [...ALL_SCOPES]);
  const grantTypes = (raw.grantTypes ?? ["authorization_code", "refresh_token", "client_credentials"]) as GrantType[];

  return {
    clientId: raw.clientId ?? "local-dev-client",
    clientSecret: raw.clientSecret,
    clientName: raw.clientName ?? "Local Dev Client",
    redirectUris: raw.redirectUris ?? ["http://127.0.0.1:8787/callback"],
    grantTypes,
    responseTypes: raw.responseTypes ?? ["code"],
    scopes,
    tenantIds: raw.tenantIds?.length ? raw.tenantIds : [defaultTenantId],
    isPublic: raw.isPublic ?? false,
    metadata: raw.metadata ?? {},
    createdAt,
    updatedAt,
  };
};

export interface AppConfig {
  env: z.infer<typeof envSchema>;
  issuerUrl: URL;
  baseUrl: URL;
  mcpUrl: URL;
  oauthProtectedResourceMetadataPath: string;
  amoRedirectUri: string;
  defaultClient: McpClientRegistration;
  seededClients: McpClientRegistration[];
}

export const loadConfig = (): AppConfig => {
  const env = envSchema.parse(process.env);
  const baseUrl = new URL(env.APP_BASE_URL);
  const mcpUrl = new URL(env.MCP_HTTP_PATH, baseUrl);
  const amoRedirectUri = env.AMO_REDIRECT_URI ?? new URL("/oauth/amocrm/callback", baseUrl).toString();

  const defaultClient = normalizeClient(
    {
      clientId: env.LOCAL_DEV_CLIENT_ID,
      clientSecret: env.LOCAL_DEV_CLIENT_SECRET,
      clientName: "Local Dev Client",
      redirectUris: [env.LOCAL_DEV_REDIRECT_URI],
      grantTypes: ["authorization_code", "refresh_token", "client_credentials"],
      responseTypes: ["code"],
      scopes: [...ALL_SCOPES],
      tenantIds: [env.DEFAULT_TENANT_ID],
      isPublic: false,
    },
    env.DEFAULT_TENANT_ID,
  );

  const additionalClients = env.MCP_CLIENTS_JSON
    ? z.array(z.any()).parse(JSON.parse(env.MCP_CLIENTS_JSON)).map((raw) =>
        normalizeClient(raw as Partial<McpClientRegistration>, env.DEFAULT_TENANT_ID),
      )
    : [];

  return {
    env,
    issuerUrl: baseUrl,
    baseUrl,
    mcpUrl,
    oauthProtectedResourceMetadataPath: `/.well-known/oauth-protected-resource${mcpUrl.pathname === "/" ? "" : mcpUrl.pathname}`,
    amoRedirectUri,
    defaultClient,
    seededClients: [defaultClient, ...additionalClients.filter((client) => client.clientId !== defaultClient.clientId)],
  };
};
