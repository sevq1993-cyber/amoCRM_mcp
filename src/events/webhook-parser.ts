import { createHash, randomUUID } from "node:crypto";
import type { AmoWebhookParseResult, NormalizedAmoEvent } from "../types.js";
import { nowIso } from "../utils/time.js";

const EVENT_KEY_PATTERN = /^([^[]+)\[([^[]+)\]\[(\d+)\]\[([^[]+)\]$/;

type RawFormBody = Record<string, string | string[] | undefined>;

const normalizeValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

export const parseAmoWebhookBody = (
  tenantId: string,
  body: Record<string, unknown>,
  accountId?: number,
): AmoWebhookParseResult => {
  const flatBody = body as RawFormBody;
  const grouped = new Map<string, Record<string, string>>();
  const receivedAt = nowIso();

  for (const [key, rawValue] of Object.entries(flatBody)) {
    const value = normalizeValue(rawValue as string | string[] | undefined);
    const match = EVENT_KEY_PATTERN.exec(key);

    if (!match || typeof value === "undefined") {
      continue;
    }

    const [, entityType, action, index, field = "value"] = match;
    const groupKey = `${entityType}:${action}:${index}`;
    const payload = grouped.get(groupKey) ?? {};
    payload[field] = value;
    grouped.set(groupKey, payload);
  }

  const events: NormalizedAmoEvent[] = [...grouped.entries()].map(([groupKey, payload]) => {
    const [entityType = "unknown", action = "unknown"] = groupKey.split(":");
    const entityId = payload.id;
    const occurredAt = payload.updated_at
      ? new Date(Number(payload.updated_at) * 1000).toISOString()
      : receivedAt;
    const dedupeKey = createHash("sha256")
      .update(`${tenantId}:${groupKey}:${JSON.stringify(payload)}`)
      .digest("hex");

    return {
      eventId: payload.uuid ?? randomUUID(),
      tenantId,
      amocrmAccountId: accountId,
      entityType,
      entityId,
      action,
      occurredAt,
      receivedAt,
      rawPayload: body,
      normalizedPayload: payload,
      dedupeKey,
    };
  });

  return {
    events,
    raw: body,
  };
};
