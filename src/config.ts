import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { ALL_SCOPES, type GrantType, type McpClientRegistration, type Scope } from "./types.js";
import { nowIso } from "./utils/time.js";

let localEnvLoaded = false;

const stripInlineComment = (value: string) => {
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];

    if (character === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (character === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (character === "#" && !inSingleQuote && !inDoubleQuote) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value.trimEnd();
};

const unescapeQuotedValue = (value: string, quote: "'" | '"') => {
  const body = value.slice(1, -1);
  if (quote === "'") {
    return body.replace(/\\(['\\])/g, "$1");
  }

  return body.replace(/\\([nrt"\\])/g, (_, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case '"':
        return '"';
      case "\\":
        return "\\";
      default:
        return escaped;
    }
  });
};

const loadLocalEnvFile = () => {
  if (localEnvLoaded) {
    return;
  }

  localEnvLoaded = true;

  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trimStart() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const rawValue = normalizedLine.slice(separatorIndex + 1);
    const cleanedValue = stripInlineComment(rawValue).trim();
    let value = cleanedValue;

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = unescapeQuotedValue(value, value[0] as "'" | '"');
    }

    process.env[key] = value;
  }
};

loadLocalEnvFile();

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
  WEBHOOK_SHARED_SECRET: z.string().default("local-webhook-secret"),
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
  webhookUrl: URL;
  oauthProtectedResourceMetadataPath: string;
  amoRedirectUri: string;
  defaultClient: McpClientRegistration;
  seededClients: McpClientRegistration[];
}

export const loadConfig = (): AppConfig => {
  const env = envSchema.parse(process.env);
  const baseUrl = new URL(env.APP_BASE_URL);
  const mcpUrl = new URL(env.MCP_HTTP_PATH, baseUrl);
  const webhookUrl = new URL("/webhooks/amocrm", baseUrl);
  if (env.WEBHOOK_SHARED_SECRET) {
    webhookUrl.searchParams.set("token", env.WEBHOOK_SHARED_SECRET);
  }
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
    webhookUrl,
    oauthProtectedResourceMetadataPath: `/.well-known/oauth-protected-resource${mcpUrl.pathname === "/" ? "" : mcpUrl.pathname}`,
    amoRedirectUri,
    defaultClient,
    seededClients: [defaultClient, ...additionalClients.filter((client) => client.clientId !== defaultClient.clientId)],
  };
};
