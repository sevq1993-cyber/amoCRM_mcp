import { describe, expect, it } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import {
  createAuthorizationServerMetadata,
  createBearerChallenge,
  createProtectedResourceMetadata,
  extractBearerToken,
  resolveMcpAuthContext,
} from "./oidc.js";
import type { AppConfig } from "../config.js";
import type { McpClientRegistration } from "../types.js";

const config = {
  issuerUrl: new URL("http://localhost:3000/"),
  baseUrl: new URL("http://localhost:3000/"),
  mcpUrl: new URL("http://localhost:3000/mcp"),
  env: {
    DEFAULT_TENANT_ID: "tenant-local",
  },
} as AppConfig;

const client: McpClientRegistration = {
  clientId: "client-1",
  clientName: "Client 1",
  clientSecret: "secret",
  redirectUris: ["http://127.0.0.1/callback"],
  grantTypes: ["authorization_code", "client_credentials", "refresh_token"],
  responseTypes: ["code"],
  scopes: ["crm.read", "crm.write", "admin.read", "admin.write", "events.read", "tenant.manage"],
  tenantIds: ["tenant-a", "tenant-b"],
  isPublic: false,
  metadata: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("oidc helpers", () => {
  it("extracts bearer tokens safely", () => {
    expect(extractBearerToken("Bearer abc.def")).toBe("abc.def");
    expect(extractBearerToken("bearer token")).toBe("token");
    expect(extractBearerToken("Basic abc")).toBeUndefined();
    expect(extractBearerToken("Bearer a b")).toBeUndefined();
    expect(extractBearerToken()).toBeUndefined();
  });

  it("builds a compliant bearer challenge", () => {
    expect(createBearerChallenge("http://localhost:3000/.well-known/oauth-protected-resource/mcp")).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/mcp"',
    );
    expect(
      createBearerChallenge(
        "http://localhost:3000/.well-known/oauth-protected-resource/mcp",
        "crm.read",
      ),
    ).toContain('scope="crm.read"');
  });

  it("normalizes auth context from token and client metadata", () => {
    const authInfo = {
      token: "token-value",
      clientId: "client-1",
      scopes: ["crm.read", "crm.write"],
      expiresAt: Math.floor(Date.now() / 1000) + 600,
      resource: new URL("http://localhost:3000/mcp"),
      extra: {
        tenantIds: ["tenant-b", "tenant-c"],
        defaultTenantId: "tenant-c",
        subject: "local-admin",
      },
    } satisfies AuthInfo;

    const result = resolveMcpAuthContext(authInfo, client, new URL("http://localhost:3000/mcp"));

    expect(result).toMatchObject({
      clientId: "client-1",
      subject: "local-admin",
      defaultTenantId: "tenant-c",
      scopes: ["crm.read", "crm.write"],
      expiresAt: authInfo.expiresAt,
    });
    expect(result.tenantIds).toEqual(["tenant-b", "tenant-c", "tenant-a"]);
    expect(result.resource?.toString()).toBe("http://localhost:3000/mcp");
  });

  it("builds stable metadata documents", () => {
    expect(createAuthorizationServerMetadata(config)).toMatchObject({
      issuer: "http://localhost:3000/",
      authorization_endpoint: "http://localhost:3000/auth",
      token_endpoint: "http://localhost:3000/token",
      jwks_uri: "http://localhost:3000/jwks",
      scopes_supported: ["crm.read", "crm.write", "admin.read", "admin.write", "events.read", "tenant.manage"],
    });

    expect(createProtectedResourceMetadata(config)).toMatchObject({
      resource: "http://localhost:3000/mcp",
      authorization_servers: ["http://localhost:3000/"],
      resource_name: "amoCRM MCP Resource Server",
    });
  });
});
