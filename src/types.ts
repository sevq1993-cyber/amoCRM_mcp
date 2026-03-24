import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export const ALL_SCOPES = [
  "crm.read",
  "crm.write",
  "admin.read",
  "admin.write",
  "events.read",
  "tenant.manage",
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

export type GrantType = "authorization_code" | "refresh_token" | "client_credentials";

export type AmoEntityType =
  | "leads"
  | "contacts"
  | "companies"
  | "tasks"
  | "users"
  | "notes"
  | "tags"
  | "pipelines"
  | "stages"
  | "custom_fields"
  | "webhooks"
  | "account";

export interface Tenant {
  id: string;
  name: string;
  active: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AmoTokenSet {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: string;
  scopeSnapshot: string[];
  serverTime?: number;
}

export interface AmoInstallation {
  tenantId: string;
  accountId?: number;
  baseDomain: string;
  integrationId: string;
  clientSecret: string;
  redirectUri: string;
  createdAt: string;
  updatedAt: string;
  tokens?: AmoTokenSet;
}

export interface McpClientRegistration {
  clientId: string;
  clientSecret?: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: GrantType[];
  responseTypes: string[];
  scopes: Scope[];
  tenantIds: string[];
  isPublic: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ClientTenantGrant {
  clientId: string;
  tenantId: string;
  scopes: Scope[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocalAccount {
  accountId: string;
  email: string;
  name: string;
  tenantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedAmoEvent {
  eventId: string;
  tenantId: string;
  amocrmAccountId?: number;
  entityType: string;
  entityId?: string;
  action: string;
  occurredAt: string;
  receivedAt: string;
  rawPayload: Record<string, unknown>;
  normalizedPayload: Record<string, unknown>;
  dedupeKey: string;
}

export interface AuditRecord {
  id: string;
  tenantId: string;
  actor: string;
  clientId?: string;
  action: string;
  target: string;
  destructive: boolean;
  diffSummary?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AmoListResult<T = unknown> {
  collection: string;
  items: T[];
  raw: Record<string, unknown>;
}

export interface ToolExecutionContext {
  tenant: Tenant;
  installation?: AmoInstallation;
  actor: string;
  clientId?: string;
  scopes: Scope[];
  authInfo?: AuthInfo;
}

export interface CacheAdapter {
  reserveWithinWindow(key: string, limit: number, windowMs: number): Promise<number>;
  putIfAbsent(key: string, ttlSeconds: number): Promise<boolean>;
  close(): Promise<void>;
}

export interface AppStore {
  initialize(): Promise<void>;
  close(): Promise<void>;
  listTenants(): Promise<Tenant[]>;
  getTenant(tenantId: string): Promise<Tenant | undefined>;
  saveTenant(tenant: Tenant): Promise<void>;
  getDefaultTenant(): Promise<Tenant | undefined>;
  getInstallation(tenantId: string): Promise<AmoInstallation | undefined>;
  saveInstallation(installation: AmoInstallation): Promise<void>;
  listClientRegistrations(): Promise<McpClientRegistration[]>;
  getClientRegistration(clientId: string): Promise<McpClientRegistration | undefined>;
  saveClientRegistration(client: McpClientRegistration): Promise<void>;
  listTenantGrants(clientId: string): Promise<ClientTenantGrant[]>;
  saveTenantGrant(grant: ClientTenantGrant): Promise<void>;
  listAccounts(): Promise<LocalAccount[]>;
  getAccount(accountId: string): Promise<LocalAccount | undefined>;
  saveAccount(account: LocalAccount): Promise<void>;
  saveEvent(event: NormalizedAmoEvent): Promise<void>;
  getEvent(tenantId: string, eventId: string): Promise<NormalizedAmoEvent | undefined>;
  listEvents(
    tenantId: string,
    options?: { limit?: number; entityType?: string; entityId?: string },
  ): Promise<NormalizedAmoEvent[]>;
  saveAuditRecord(record: AuditRecord): Promise<void>;
  listAuditRecords(tenantId: string, limit?: number): Promise<AuditRecord[]>;
}

export interface AmoTokenExchangeResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
  server_time?: number;
}

export interface AmoApiRequest {
  tenantId: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  requiresConfirm?: boolean;
}

export interface AmoApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Headers;
}

export interface AmoOAuthCallbackResult {
  tenantId: string;
  installation: AmoInstallation;
}

export interface AmoWebhookParseResult {
  events: NormalizedAmoEvent[];
  raw: Record<string, unknown>;
}
