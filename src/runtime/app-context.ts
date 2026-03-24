import type { AppConfig } from "../config.js";
import type { AmoCrmClient } from "../amocrm/client.js";
import type { OidcFacade } from "../auth/oidc.js";
import type { AuditService } from "../audit/service.js";
import type { EventService } from "../events/service.js";
import type { AppStore, CacheAdapter } from "../types.js";
import type { AppLogger } from "../observability/logger.js";

export interface AppContext {
  config: AppConfig;
  logger: AppLogger;
  store: AppStore;
  cache: CacheAdapter;
  oidc: OidcFacade;
  amo: AmoCrmClient;
  audit: AuditService;
  events: EventService;
}
