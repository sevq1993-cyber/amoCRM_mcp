import { Pool } from "pg";
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

const SCHEMA = `
create table if not exists tenants (
  id text primary key,
  name text not null,
  active boolean not null,
  metadata jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create table if not exists amo_installations (
  tenant_id text primary key references tenants(id) on delete cascade,
  payload jsonb not null
);

create table if not exists mcp_clients (
  client_id text primary key,
  payload jsonb not null
);

create table if not exists client_tenant_grants (
  client_id text not null,
  tenant_id text not null,
  payload jsonb not null,
  primary key (client_id, tenant_id)
);

create table if not exists local_accounts (
  account_id text primary key,
  payload jsonb not null
);

create table if not exists normalized_events (
  event_id text not null,
  tenant_id text not null,
  occurred_at timestamptz not null,
  entity_type text not null,
  entity_id text,
  payload jsonb not null,
  primary key (event_id, tenant_id)
);

create table if not exists audit_records (
  id text primary key,
  tenant_id text not null,
  created_at timestamptz not null,
  payload jsonb not null
);
`;

const parsePayload = <T>(value: unknown): T => value as T;

export class PostgresAppStore implements AppStore {
  constructor(private readonly pool: Pool) {}

  async initialize(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async listTenants(): Promise<Tenant[]> {
    const result = await this.pool.query("select metadata, id, name, active, created_at, updated_at from tenants order by created_at asc");
    return result.rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      active: row.active,
      metadata: row.metadata ?? {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }

  async getTenant(tenantId: string): Promise<Tenant | undefined> {
    const result = await this.pool.query(
      "select metadata, id, name, active, created_at, updated_at from tenants where id = $1 limit 1",
      [tenantId],
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      name: row.name,
      active: row.active,
      metadata: row.metadata ?? {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async saveTenant(tenant: Tenant): Promise<void> {
    await this.pool.query(
      `
        insert into tenants (id, name, active, metadata, created_at, updated_at)
        values ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::timestamptz)
        on conflict (id) do update
          set name = excluded.name,
              active = excluded.active,
              metadata = excluded.metadata,
              updated_at = excluded.updated_at
      `,
      [tenant.id, tenant.name, tenant.active, JSON.stringify(tenant.metadata), tenant.createdAt, tenant.updatedAt],
    );
  }

  async getDefaultTenant(): Promise<Tenant | undefined> {
    const result = await this.pool.query(
      "select metadata, id, name, active, created_at, updated_at from tenants where active = true order by created_at asc limit 1",
    );
    const row = result.rows[0];
    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      name: row.name,
      active: row.active,
      metadata: row.metadata ?? {},
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }

  async getInstallation(tenantId: string): Promise<AmoInstallation | undefined> {
    const result = await this.pool.query("select payload from amo_installations where tenant_id = $1 limit 1", [tenantId]);
    return result.rows[0] ? parsePayload<AmoInstallation>(result.rows[0].payload) : undefined;
  }

  async saveInstallation(installation: AmoInstallation): Promise<void> {
    await this.pool.query(
      `
        insert into amo_installations (tenant_id, payload)
        values ($1, $2::jsonb)
        on conflict (tenant_id) do update
          set payload = excluded.payload
      `,
      [installation.tenantId, JSON.stringify(installation)],
    );
  }

  async listClientRegistrations(): Promise<McpClientRegistration[]> {
    const result = await this.pool.query("select payload from mcp_clients order by client_id asc");
    return result.rows.map((row: any) => parsePayload<McpClientRegistration>(row.payload));
  }

  async getClientRegistration(clientId: string): Promise<McpClientRegistration | undefined> {
    const result = await this.pool.query("select payload from mcp_clients where client_id = $1 limit 1", [clientId]);
    return result.rows[0] ? parsePayload<McpClientRegistration>(result.rows[0].payload) : undefined;
  }

  async saveClientRegistration(client: McpClientRegistration): Promise<void> {
    await this.pool.query(
      `
        insert into mcp_clients (client_id, payload)
        values ($1, $2::jsonb)
        on conflict (client_id) do update
          set payload = excluded.payload
      `,
      [client.clientId, JSON.stringify(client)],
    );
  }

  async listTenantGrants(clientId: string): Promise<ClientTenantGrant[]> {
    const result = await this.pool.query("select payload from client_tenant_grants where client_id = $1", [clientId]);
    return result.rows.map((row: any) => parsePayload<ClientTenantGrant>(row.payload));
  }

  async saveTenantGrant(grant: ClientTenantGrant): Promise<void> {
    await this.pool.query(
      `
        insert into client_tenant_grants (client_id, tenant_id, payload)
        values ($1, $2, $3::jsonb)
        on conflict (client_id, tenant_id) do update
          set payload = excluded.payload
      `,
      [grant.clientId, grant.tenantId, JSON.stringify(grant)],
    );
  }

  async listAccounts(): Promise<LocalAccount[]> {
    const result = await this.pool.query("select payload from local_accounts order by account_id asc");
    return result.rows.map((row: any) => parsePayload<LocalAccount>(row.payload));
  }

  async getAccount(accountId: string): Promise<LocalAccount | undefined> {
    const result = await this.pool.query("select payload from local_accounts where account_id = $1 limit 1", [accountId]);
    return result.rows[0] ? parsePayload<LocalAccount>(result.rows[0].payload) : undefined;
  }

  async saveAccount(account: LocalAccount): Promise<void> {
    await this.pool.query(
      `
        insert into local_accounts (account_id, payload)
        values ($1, $2::jsonb)
        on conflict (account_id) do update
          set payload = excluded.payload
      `,
      [account.accountId, JSON.stringify(account)],
    );
  }

  async saveEvent(event: NormalizedAmoEvent): Promise<void> {
    await this.pool.query(
      `
        insert into normalized_events (event_id, tenant_id, occurred_at, entity_type, entity_id, payload)
        values ($1, $2, $3::timestamptz, $4, $5, $6::jsonb)
        on conflict (event_id, tenant_id) do update
          set payload = excluded.payload,
              occurred_at = excluded.occurred_at,
              entity_type = excluded.entity_type,
              entity_id = excluded.entity_id
      `,
      [event.eventId, event.tenantId, event.occurredAt, event.entityType, event.entityId ?? null, JSON.stringify(event)],
    );
  }

  async getEvent(tenantId: string, eventId: string): Promise<NormalizedAmoEvent | undefined> {
    const result = await this.pool.query(
      "select payload from normalized_events where tenant_id = $1 and event_id = $2 limit 1",
      [tenantId, eventId],
    );
    return result.rows[0] ? parsePayload<NormalizedAmoEvent>(result.rows[0].payload) : undefined;
  }

  async listEvents(
    tenantId: string,
    options?: { limit?: number; entityType?: string; entityId?: string },
  ): Promise<NormalizedAmoEvent[]> {
    const result = await this.pool.query(
      `
        select payload
        from normalized_events
        where tenant_id = $1
          and ($2::text is null or entity_type = $2)
          and ($3::text is null or entity_id = $3)
        order by occurred_at desc
        limit $4
      `,
      [tenantId, options?.entityType ?? null, options?.entityId ?? null, options?.limit ?? 50],
    );
    return result.rows.map((row: any) => parsePayload<NormalizedAmoEvent>(row.payload));
  }

  async saveAuditRecord(record: AuditRecord): Promise<void> {
    await this.pool.query(
      `
        insert into audit_records (id, tenant_id, created_at, payload)
        values ($1, $2, $3::timestamptz, $4::jsonb)
        on conflict (id) do update
          set payload = excluded.payload,
              created_at = excluded.created_at
      `,
      [record.id, record.tenantId, record.createdAt, JSON.stringify(record)],
    );
  }

  async listAuditRecords(tenantId: string, limit = 100): Promise<AuditRecord[]> {
    const result = await this.pool.query(
      "select payload from audit_records where tenant_id = $1 order by created_at desc limit $2",
      [tenantId, limit],
    );
    return result.rows.map((row: any) => parsePayload<AuditRecord>(row.payload));
  }
}
