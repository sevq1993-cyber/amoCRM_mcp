import { describe, expect, it } from "vitest";
import { AppError } from "../utils/errors.js";
import {
  assertApiPath,
  buildSettingsPath,
  buildTenantResourceUris,
  getRawRequestRequiredScopes,
  isAdminSensitiveApiPath,
} from "./contracts.js";

describe("mcp contracts", () => {
  it("builds expected resource URIs for each tenant", () => {
    const uris = buildTenantResourceUris(["tenant-a", "tenant-b"]);

    expect(uris).toHaveLength(14);
    expect(uris[0]).toEqual({
      uri: "amocrm://tenant/tenant-a/account",
      name: "account",
    });
    expect(uris.at(-1)).toEqual({
      uri: "amocrm://tenant/tenant-b/events/recent",
      name: "recent-events",
    });
    expect(uris.filter((resource) => resource.name.startsWith("custom-fields-"))).toHaveLength(6);
  });

  it("builds known admin paths and rejects missing required params", () => {
    expect(buildSettingsPath({ settingType: "account" })).toBe("/api/v4/account");
    expect(buildSettingsPath({ settingType: "pipelines", resourceId: "42" })).toBe("/api/v4/leads/pipelines/42");
    expect(buildSettingsPath({ settingType: "stages", pipelineId: "123", resourceId: "456" })).toBe(
      "/api/v4/leads/pipelines/123/statuses/456",
    );

    expect(() => buildSettingsPath({ settingType: "stages" })).toThrow(AppError);
    expect(() => buildSettingsPath({ settingType: "custom_fields" })).toThrow(AppError);
    expect(() => buildSettingsPath({ settingType: "webhooks", resourceId: "bad/id" })).toThrow(AppError);
  });

  it("restricts raw request paths to amoCRM api v4", () => {
    expect(assertApiPath("/api/v4/leads?limit=10")).toBe("/api/v4/leads");
    expect(() => assertApiPath("/oauth2/access_token")).toThrow(AppError);
  });

  it("classifies admin-sensitive raw request paths", () => {
    expect(isAdminSensitiveApiPath("/api/v4/leads/pipelines")).toBe(true);
    expect(isAdminSensitiveApiPath("/api/v4/contacts/custom_fields")).toBe(true);
    expect(isAdminSensitiveApiPath("/api/v4/leads")).toBe(false);

    expect(getRawRequestRequiredScopes("GET", "/api/v4/leads/pipelines")).toEqual(["admin.read"]);
    expect(getRawRequestRequiredScopes("GET", "/api/v4/leads")).toEqual(["crm.read"]);
    expect(getRawRequestRequiredScopes("POST", "/api/v4/leads")).toEqual(["admin.write"]);
  });

  it("encodes tenant resource uris", () => {
    expect(buildTenantResourceUris(["tenant/a"])[0]).toEqual({
      uri: "amocrm://tenant/tenant%2Fa/account",
      name: "account",
    });
  });
});
