import { z } from "zod";
import type { AppContext } from "../runtime/app-context.js";
import type { Scope } from "../types.js";
import { AppError, ensure } from "../utils/errors.js";

export const collectionEnum = z.enum(["leads", "contacts", "companies", "tasks", "users", "notes"]);
export const mutableCollectionEnum = z.enum(["leads", "contacts", "companies", "tasks"]);
export const settingsEnum = z.enum(["account", "pipelines", "stages", "custom_fields", "webhooks", "users"]);

export const SUPPORTED_SCOPES = [
  "crm.read",
  "crm.write",
  "admin.read",
  "admin.write",
  "events.read",
  "tenant.manage",
] as const satisfies readonly Scope[];

export const CUSTOM_FIELD_RESOURCE_ENTITIES = ["leads", "contacts", "companies"] as const;

const SAFE_PATH_FRAGMENT = /^[A-Za-z0-9._:-]+$/;

export const normalizeApiPath = (path: string) => path.split(/[?#]/, 1)[0] ?? path;

export const encodePathFragment = (value: string, label: string) => {
  ensure(typeof value === "string" && value.trim().length > 0, `${label} is required`, {
    statusCode: 400,
    code: "validation_error",
  });

  const normalized = value.trim();
  ensure(SAFE_PATH_FRAGMENT.test(normalized), `${label} contains unsupported path characters`, {
    statusCode: 400,
    code: "validation_error",
  });

  return encodeURIComponent(normalized);
};

export const buildSettingsPath = (input: {
  settingType: z.infer<typeof settingsEnum>;
  entityType?: string;
  pipelineId?: string;
  resourceId?: string;
}) => {
  switch (input.settingType) {
    case "account":
      return "/api/v4/account";
    case "users":
      return "/api/v4/users";
    case "pipelines":
      return input.resourceId
        ? `/api/v4/leads/pipelines/${encodePathFragment(input.resourceId, "resourceId")}`
        : "/api/v4/leads/pipelines";
    case "stages":
      ensure(input.pipelineId, "pipelineId is required for stages", { statusCode: 400, code: "validation_error" });
      return input.resourceId
        ? `/api/v4/leads/pipelines/${encodePathFragment(input.pipelineId, "pipelineId")}/statuses/${encodePathFragment(input.resourceId, "resourceId")}`
        : `/api/v4/leads/pipelines/${encodePathFragment(input.pipelineId, "pipelineId")}/statuses`;
    case "custom_fields":
      ensure(input.entityType, "entityType is required for custom_fields", {
        statusCode: 400,
        code: "validation_error",
      });
      return input.resourceId
        ? `/api/v4/${encodePathFragment(input.entityType, "entityType")}/custom_fields/${encodePathFragment(input.resourceId, "resourceId")}`
        : `/api/v4/${encodePathFragment(input.entityType, "entityType")}/custom_fields`;
    case "webhooks":
      return input.resourceId
        ? `/api/v4/webhooks/${encodePathFragment(input.resourceId, "resourceId")}`
        : "/api/v4/webhooks";
  }
};

export const buildTenantResourceUris = (tenantIds: string[]) => {
  const uris: Array<{ uri: string; name: string }> = [];

  for (const tenantId of tenantIds) {
    const encodedTenantId = encodeURIComponent(tenantId);
    uris.push({ uri: `amocrm://tenant/${encodedTenantId}/account`, name: "account" });
    uris.push({ uri: `amocrm://tenant/${encodedTenantId}/users`, name: "users" });
    uris.push({ uri: `amocrm://tenant/${encodedTenantId}/pipelines`, name: "pipelines" });
    for (const entityType of CUSTOM_FIELD_RESOURCE_ENTITIES) {
      uris.push({
        uri: `amocrm://tenant/${encodedTenantId}/custom-fields/${entityType}`,
        name: `custom-fields-${entityType}`,
      });
    }
    uris.push({ uri: `amocrm://tenant/${encodedTenantId}/events/recent`, name: "recent-events" });
  }

  return uris;
};

export const parseTenantIds = (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
  const tenantIds = extra.authInfo?.extra?.tenantIds;
  return Array.isArray(tenantIds) ? tenantIds.filter((item): item is string => typeof item === "string") : undefined;
};

export const getDefaultTenantId = (extra: { authInfo?: { extra?: Record<string, unknown> } }) => {
  const tenantId = extra.authInfo?.extra?.defaultTenantId;
  return typeof tenantId === "string" ? tenantId : undefined;
};

export const resolveTenantId = (
  app: AppContext,
  extra: { authInfo?: { extra?: Record<string, unknown> } },
  tenantId?: string,
) => {
  return tenantId ?? getDefaultTenantId(extra) ?? app.config.env.DEFAULT_TENANT_ID;
};

export const assertApiPath = (path: string) => {
  const normalizedPath = normalizeApiPath(path);
  if (!normalizedPath.startsWith("/api/v4/")) {
    throw new AppError("Only amoCRM API v4 paths are allowed", {
      statusCode: 400,
      code: "validation_error",
    });
  }

  return normalizedPath;
};

export const isAdminSensitiveApiPath = (path: string) => {
  const normalizedPath = normalizeApiPath(path);

  return (
    normalizedPath === "/api/v4/account" ||
    normalizedPath.startsWith("/api/v4/account/") ||
    normalizedPath === "/api/v4/users" ||
    normalizedPath.startsWith("/api/v4/users/") ||
    normalizedPath.startsWith("/api/v4/leads/pipelines") ||
    normalizedPath.startsWith("/api/v4/webhooks") ||
    /^\/api\/v4\/(leads|contacts|companies)\/custom_fields(?:\/|$)/.test(normalizedPath)
  );
};

export const getRawRequestRequiredScopes = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string): Scope[] => {
  if (method !== "GET") {
    return ["admin.write"];
  }

  return isAdminSensitiveApiPath(path) ? ["admin.read"] : ["crm.read"];
};
