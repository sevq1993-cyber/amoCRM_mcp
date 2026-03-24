import type { AppStore, CacheAdapter, NormalizedAmoEvent } from "../types.js";

export class EventService {
  constructor(
    private readonly store: AppStore,
    private readonly cache: CacheAdapter,
  ) {}

  async ingest(events: NormalizedAmoEvent[]): Promise<NormalizedAmoEvent[]> {
    const accepted: NormalizedAmoEvent[] = [];

    for (const event of events) {
      const unique = await this.cache.putIfAbsent(`dedupe:${event.dedupeKey}`, 300);
      if (!unique) {
        continue;
      }

      await this.store.saveEvent(event);
      accepted.push(event);
    }

    return accepted;
  }

  async list(tenantId: string, options?: { limit?: number; entityType?: string; entityId?: string }) {
    return await this.store.listEvents(tenantId, options);
  }

  async get(tenantId: string, eventId: string) {
    return await this.store.getEvent(tenantId, eventId);
  }
}
