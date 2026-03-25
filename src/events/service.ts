import { AppError } from "../utils/errors.js";
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

  async replay(
    tenantId: string,
    eventId: string,
    options?: { limit?: number },
  ): Promise<{ event: NormalizedAmoEvent; related: NormalizedAmoEvent[] }> {
    const event = await this.get(tenantId, eventId);
    if (!event) {
      throw new AppError(`Event ${eventId} not found`, {
        statusCode: 404,
        code: "event_not_found",
      });
    }

    const related = await this.list(tenantId, {
      limit: options?.limit ?? 10,
      entityType: event.entityType,
      entityId: event.entityId,
    });

    return {
      event,
      related,
    };
  }
}
