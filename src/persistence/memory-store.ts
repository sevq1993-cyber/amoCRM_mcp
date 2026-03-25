import type {
  AmoInstallation,
  AppStore,
  AuditRecord,
  ClientTenantGrant,
  LocalAccount,
  McpClientRegistration,
  NormalizedAmoEvent,
  Tenant,
} from "../types.js";

export class MemoryAppStore implements AppStore {
  private readonly tenants = new Map<string, Tenant>();
  private readonly installations = new Map<string, AmoInstallation>();
  private readonly clients = new Map<string, McpClientRegistration>();
  private readonly grants = new Map<string, ClientTenantGrant>();
  private readonly accounts = new Map<string, LocalAccount>();
  private readonly events = new Map<string, NormalizedAmoEvent>();
  private readonly audit = new Map<string, AuditRecord>();

  async initialize(): Promise<void> {}

  async close(): Promise<void> {}

  async listTenants(): Promise<Tenant[]> {
    return [...this.tenants.values()];
  }

  async getTenant(tenantId: string): Promise<Tenant | undefined> {
    return this.tenants.get(tenantId);
  }

  async saveTenant(tenant: Tenant): Promise<void> {
    this.tenants.set(tenant.id, tenant);
  }

  async getDefaultTenant(): Promise<Tenant | undefined> {
    return [...this.tenants.values()].find((tenant) => tenant.active);
  }

  async getInstallation(tenantId: string): Promise<AmoInstallation | undefined> {
    return this.installations.get(tenantId);
  }

  async saveInstallation(installation: AmoInstallation): Promise<void> {
    this.installations.set(installation.tenantId, installation);
  }

  async listClientRegistrations(): Promise<McpClientRegistration[]> {
    return [...this.clients.values()];
  }

  async getClientRegistration(clientId: string): Promise<McpClientRegistration | undefined> {
    return this.clients.get(clientId);
  }

  async saveClientRegistration(client: McpClientRegistration): Promise<void> {
    this.clients.set(client.clientId, client);
  }

  async listTenantGrants(clientId: string): Promise<ClientTenantGrant[]> {
    return [...this.grants.values()].filter((grant) => grant.clientId === clientId);
  }

  async saveTenantGrant(grant: ClientTenantGrant): Promise<void> {
    this.grants.set(`${grant.clientId}:${grant.tenantId}`, grant);
  }

  async listAccounts(): Promise<LocalAccount[]> {
    return [...this.accounts.values()];
  }

  async getAccount(accountId: string): Promise<LocalAccount | undefined> {
    return this.accounts.get(accountId);
  }

  async saveAccount(account: LocalAccount): Promise<void> {
    this.accounts.set(account.accountId, account);
  }

  async saveEvent(event: NormalizedAmoEvent): Promise<void> {
    this.events.set(`${event.tenantId}:${event.eventId}`, event);
  }

  async getEvent(tenantId: string, eventId: string): Promise<NormalizedAmoEvent | undefined> {
    return this.events.get(`${tenantId}:${eventId}`);
  }

  async listEvents(
    tenantId: string,
    options?: { limit?: number; entityType?: string; entityId?: string },
  ): Promise<NormalizedAmoEvent[]> {
    const limit = options?.limit ?? 50;
    return [...this.events.values()]
      .filter((event) => event.tenantId === tenantId)
      .filter((event) => (options?.entityType ? event.entityType === options.entityType : true))
      .filter((event) => (options?.entityId ? event.entityId === options.entityId : true))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, limit);
  }

  async saveAuditRecord(record: AuditRecord): Promise<void> {
    this.audit.set(record.id, record);
  }

  async listAuditRecords(tenantId: string, limit = 100): Promise<AuditRecord[]> {
    return [...this.audit.values()]
      .filter((record) => record.tenantId === tenantId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }
}
