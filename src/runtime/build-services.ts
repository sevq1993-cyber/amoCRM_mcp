import { AmoCrmClient } from "../amocrm/client.js";
import { createOidcFacade } from "../auth/oidc.js";
import { AuditService } from "../audit/service.js";
import { EventService } from "../events/service.js";
import type { AppContext } from "./app-context.js";
import { bootstrap } from "./bootstrap.js";

export const buildAppContext = async (): Promise<AppContext> => {
  const base = await bootstrap();
  const audit = new AuditService(base.store);
  const events = new EventService(base.store, base.cache);
  const amo = new AmoCrmClient(base.store, base.cache, base.config.amoRedirectUri);
  const oidc = await createOidcFacade(base.store, base.config);

  return {
    ...base,
    audit,
    events,
    amo,
    oidc,
  };
};
