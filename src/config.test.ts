import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

const previousEnv = { ...process.env };

describe("loadConfig", () => {
  afterEach(() => {
    process.env = { ...previousEnv };
  });

  it("seeds a local development client and URLs", () => {
    process.env.APP_BASE_URL = "http://localhost:3456";
    process.env.DEFAULT_TENANT_ID = "tenant-local";

    const config = loadConfig();

    expect(config.defaultClient.clientId).toBe("local-dev-client");
    expect(config.mcpUrl.toString()).toBe("http://localhost:3456/mcp");
    expect(config.oauthProtectedResourceMetadataPath).toBe("/.well-known/oauth-protected-resource/mcp");
    expect(config.defaultClient.tenantIds).toEqual(["tenant-local"]);
  });
});
