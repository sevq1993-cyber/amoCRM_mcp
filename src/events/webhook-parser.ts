import { createHash } from "node:crypto";
import type { AmoWebhookParseResult, NormalizedAmoEvent } from "../types.js";
import { nowIso } from "../utils/time.js";

const EVENT_KEY_PATTERN = /^([^[\]]+)\[([^[\]]+)\](?:\[(\d+)\])?(?:\[([^[\]]+)\])?$/;

type RawPayloadValue = string | string[] | Record<string, unknown> | undefined;
type EventGroup = {
  entityType: string;
  action: string;
  payload: Record<string, string>;
};

const normalizeValue = (value: RawPayloadValue): RawPayloadValue => {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
};

const toBracketKey = (parts: string[]): string =>
  parts.reduce((acc, part, index) => (index === 0 ? part : `${acc}[${part}]`), "");

const flattenObject = (input: Record<string, unknown>, prefix: string[] = []): Array<[string, string | string[]]> => {
  const entries: Array<[string, string | string[]]> = [];

  for (const [key, value] of Object.entries(input)) {
    const nextPrefix = [...prefix, key];

    if (Array.isArray(value)) {
      entries.push([toBracketKey(nextPrefix), value.map((item) => String(item))]);
      continue;
    }

    if (value && typeof value === "object") {
      entries.push(...flattenObject(value as Record<string, unknown>, nextPrefix));
      continue;
    }

    entries.push([toBracketKey(nextPrefix), String(value)]);
  }

  return entries;
};

const parseAccountId = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const normalized = Number(value);
    if (Number.isInteger(normalized) && normalized > 0) {
      return normalized;
    }
  }

  return undefined;
};

const extractWebhookAccountId = (body: Record<string, unknown>): number | undefined =>
  parseAccountId(body.account_id ?? body["account[id]"]);

const parseOccurredAt = (timestamp: string | undefined, fallback: string): string => {
  if (!timestamp) {
    return fallback;
  }

  const numericTimestamp = Number(timestamp);
  if (!Number.isFinite(numericTimestamp)) {
    return fallback;
  }

  const occurredAt = new Date(numericTimestamp * 1000);
  if (Number.isNaN(occurredAt.getTime())) {
    return fallback;
  }

  return occurredAt.toISOString();
};

const parseFieldKey = (key: string) => {
  const match = EVENT_KEY_PATTERN.exec(key);

  if (!match) {
    return undefined;
  }

  const [, entityType, action, index, field] = match;
  if (!entityType || !action) {
    return undefined;
  }

  if (entityType === "account") {
    return undefined;
  }

  return {
    entityType,
    action,
    index: index ?? "0",
    field: field ?? "id",
  };
};

const normalizeEntries = (body: Record<string, unknown>): Array<[string, RawPayloadValue]> => {
  const entries: Array<[string, RawPayloadValue]> = [];

  for (const [key, value] of Object.entries(body)) {
    const normalizedValue = normalizeValue(value as RawPayloadValue);

    if (normalizedValue && typeof normalizedValue === "object" && !Array.isArray(normalizedValue)) {
      for (const [nestedKey, nestedValue] of flattenObject(normalizedValue)) {
        entries.push([`${key}[${nestedKey}]`, nestedValue]);
      }
      continue;
    }

    entries.push([key, normalizedValue]);
  }

  return entries;
};

export const parseAmoWebhookBody = (
  tenantId: string,
  body: Record<string, unknown>,
  accountId?: number,
): AmoWebhookParseResult => {
  const flatBody = body as Record<string, RawPayloadValue>;
  const grouped = new Map<string, EventGroup>();
  const receivedAt = nowIso();
  const expectedAccountId = parseAccountId(accountId);
  const webhookAccountId = extractWebhookAccountId(body);

  if (expectedAccountId && webhookAccountId && expectedAccountId !== webhookAccountId) {
    return {
      events: [],
      raw: body,
    };
  }

  const normalizedAccountId = webhookAccountId ?? expectedAccountId;

  for (const [key, rawValue] of normalizeEntries(flatBody)) {
    const value = typeof rawValue === "undefined" ? undefined : String(rawValue);
    const parsedKey = parseFieldKey(key);

    if (!parsedKey || typeof value === "undefined") {
      continue;
    }

    const groupKey = `${parsedKey.entityType}:${parsedKey.action}:${parsedKey.index}`;
    let payload = grouped.get(groupKey);
    if (!payload) {
      payload = {
        entityType: parsedKey.entityType,
        action: parsedKey.action,
        payload: {},
      };
    }
    payload.payload[parsedKey.field] = value;
    grouped.set(groupKey, payload);
  }

  const events: NormalizedAmoEvent[] = [...grouped.entries()].map(([groupKey, payload]) => {
    const entityId = payload.payload.id ?? payload.payload.entity_id;
    const timestamp =
      payload.payload.updated_at ?? payload.payload.created_at ?? payload.payload.deleted_at ?? payload.payload.event_time;
    const occurredAt = parseOccurredAt(timestamp, receivedAt);
    const dedupeKey = createHash("sha256")
      .update(
        stableStringify({
          tenantId,
          accountId: normalizedAccountId,
          groupKey,
          payload: payload.payload,
        }),
      )
      .digest("hex");

    return {
      eventId: dedupeKey,
      tenantId,
      amocrmAccountId: normalizedAccountId,
      entityType: payload.entityType,
      entityId,
      action: payload.action,
      occurredAt,
      receivedAt,
      rawPayload: body,
      normalizedPayload: {
        entityType: payload.entityType,
        action: payload.action,
        ...payload.payload,
      },
      dedupeKey,
    };
  });

  return {
    events,
    raw: body,
  };
};
