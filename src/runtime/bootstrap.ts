import { randomUUID } from "node:crypto";
import { loadConfig, type AppConfig } from "../config.js";
import { createLogger, type AppLogger } from "../observability/logger.js";
import { createCacheAdapter } from "../persistence/cache.js";
import { createAppStore } from "../persistence/factory.js";
import type { AppStore, CacheAdapter, LocalAccount, Tenant } from "../types.js";
import { nowIso } from "../utils/time.js";

export interface BootstrapContext {
  config: AppConfig;
  logger: AppLogger;
  store: AppStore;
  cache: CacheAdapter;
}

const seedTenant = (config: AppConfig): Tenant => ({
  id: config.env.DEFAULT_TENANT_ID,
  name: config.env.DEFAULT_TENANT_NAME,
  active: true,
  metadata: {
    bootstrapMode: config.env.POSTGRES_URL ? "postgres" : "memory",
  },
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

const seedAccount = (config: AppConfig): LocalAccount => ({
  accountId: config.env.LOCAL_ADMIN_ACCOUNT_ID,
  email: config.env.LOCAL_ADMIN_EMAIL,
  name: config.env.LOCAL_ADMIN_NAME,
  tenantIds: [config.env.DEFAULT_TENANT_ID],
  createdAt: nowIso(),
  updatedAt: nowIso(),
});

export const bootstrap = async (): Promise<BootstrapContext> => {
  const config = loadConfig();
  const logger = createLogger();
  const store = await createAppStore();
  await store.initialize();
  const cache = await createCacheAdapter(config.env.REDIS_URL);

  const defaultTenant = await store.getTenant(config.env.DEFAULT_TENANT_ID);
  if (!defaultTenant) {
    await store.saveTenant(seedTenant(config));
  }

  const account = await store.getAccount(config.env.LOCAL_ADMIN_ACCOUNT_ID);
  if (!account) {
    await store.saveAccount(seedAccount(config));
  }

  for (const client of config.seededClients) {
    const existing = await store.getClientRegistration(client.clientId);
    if (!existing) {
      await store.saveClientRegistration(client);
    }

    for (const tenantId of client.tenantIds) {
      await store.saveTenantGrant({
        clientId: client.clientId,
        tenantId,
        scopes: client.scopes,
        isDefault: tenantId === client.tenantIds[0],
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
  }

  if (config.env.AMO_INTEGRATION_ID !== "replace-me" && config.env.AMO_CLIENT_SECRET !== "replace-me") {
    const existingInstallation = await store.getInstallation(config.env.DEFAULT_TENANT_ID);
    if (!existingInstallation) {
      await store.saveInstallation({
        tenantId: config.env.DEFAULT_TENANT_ID,
        accountId: config.env.AMO_ACCOUNT_ID,
        baseDomain: config.env.AMO_BASE_DOMAIN,
        integrationId: config.env.AMO_INTEGRATION_ID,
        clientSecret: config.env.AMO_CLIENT_SECRET,
        redirectUri: config.amoRedirectUri,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
    }
  }

  logger.info(
    {
      requestId: randomUUID(),
      mode: config.env.POSTGRES_URL ? "postgres" : "memory",
      redis: Boolean(config.env.REDIS_URL),
    },
    "bootstrap complete",
  );

  return { config, logger, store, cache };
};
