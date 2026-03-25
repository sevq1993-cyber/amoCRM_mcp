import { describe, expect, it } from "vitest";
import { parseAmoWebhookBody } from "./webhook-parser.js";

describe("parseAmoWebhookBody", () => {
  it("normalizes amoCRM flat webhook form payload into events", () => {
    const payload = {
      account_id: "77",
      "leads[add][0][id]": "101",
      "leads[add][0][updated_at]": "1710000000",
      "contacts[update][0][id]": "202",
      "contacts[update][0][updated_at]": "1710000001",
    };

    const result = parseAmoWebhookBody("tenant-1", payload, 77);

    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      tenantId: "tenant-1",
      amocrmAccountId: 77,
    });
    expect(result.events.map((event) => `${event.entityType}:${event.action}`)).toEqual([
      "leads:add",
      "contacts:update",
    ]);
  });

  it("produces stable event ids for the same semantic payload even if field order changes", () => {
    const first = parseAmoWebhookBody("tenant-1", {
      "leads[update][0][id]": "101",
      "leads[update][0][updated_at]": "1710000000",
      "leads[update][0][status_id]": "222",
    });
    const second = parseAmoWebhookBody("tenant-1", {
      "leads[update][0][status_id]": "222",
      "leads[update][0][updated_at]": "1710000000",
      "leads[update][0][id]": "101",
    });

    expect(first.events).toHaveLength(1);
    expect(second.events).toHaveLength(1);
    expect(first.events[0]?.eventId).toBe(second.events[0]?.eventId);
    expect(first.events[0]?.dedupeKey).toBe(second.events[0]?.dedupeKey);
  });

  it("handles delete-style payloads without an array index", () => {
    const result = parseAmoWebhookBody("tenant-1", {
      account_id: "77",
      "contacts[delete][id]": "202",
      "contacts[delete][deleted_at]": "1710009999",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      entityType: "contacts",
      action: "delete",
      entityId: "202",
    });
  });

  it("falls back to receivedAt when webhook timestamps are invalid", () => {
    const result = parseAmoWebhookBody("tenant-1", {
      account_id: "77",
      "leads[add][0][id]": "101",
      "leads[add][0][updated_at]": "not-a-timestamp",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      amocrmAccountId: 77,
      entityId: "101",
    });
    expect(result.events[0]?.occurredAt).toBe(result.events[0]?.receivedAt);
  });

  it("drops webhook batches whose account id does not match the installation", () => {
    const result = parseAmoWebhookBody(
      "tenant-1",
      {
        account_id: "77",
        "leads[add][0][id]": "101",
        "leads[add][0][updated_at]": "1710000000",
      },
      78,
    );

    expect(result.events).toHaveLength(0);
  });

  it("ignores account metadata fields when normalizing events", () => {
    const result = parseAmoWebhookBody("tenant-1", {
      "account[id]": "77",
      "account[subdomain]": "acme",
      "leads[add][0][id]": "101",
      "leads[add][0][updated_at]": "1710000000",
    });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      entityType: "leads",
      action: "add",
      entityId: "101",
    });
  });
});
