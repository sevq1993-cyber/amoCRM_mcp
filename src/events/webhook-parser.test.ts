import { describe, expect, it } from "vitest";
import { parseAmoWebhookBody } from "./webhook-parser.js";

describe("parseAmoWebhookBody", () => {
  it("normalizes amoCRM flat webhook form payload into events", () => {
    const payload = {
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
});
