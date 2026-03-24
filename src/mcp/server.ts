import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { AppContext } from "../runtime/app-context.js";
import type { Scope, Tenant, ToolExecutionContext } from "../types.js";
import { AppError, ensure, toError } from "../utils/errors.js";

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

const jsonSchemaRecord = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));
const maybeJsonRecord = jsonSchemaRecord.optional();

const toPrettyJson = (value: unknown) => JSON.stringify(value, null, 2);

const parseTenantIds = (extra: Extra): string[] | undefined => {
  const tenantIds = extra.authInfo?.extra?.tenantIds;
  return Array.isArray(tenantIds) ? tenantIds.filter((item): item is string => typeof item === "string") : undefined;
};

const getDefaultTenantId = (extra: Extra): string | undefined => {
  const tenantId = extra.authInfo?.extra?.defaultTenantId;
  return typeof tenantId === "string" ? tenantId : undefined;
};

const resolveContext = async (
  app: AppContext,
  extra: Extra,
  tenantId?: string,
): Promise<ToolExecutionContext> => {
  const allowedTenantIds = parseTenantIds(extra);
  const resolvedTenantId = tenantId ?? getDefaultTenantId(extra) ?? app.config.env.DEFAULT_TENANT_ID;

  if (allowedTenantIds && allowedTenantIds.length > 0 && !allowedTenantIds.includes(resolvedTenantId)) {
    throw new AppError(`Client is not allowed to access tenant ${resolvedTenantId}`, {
      statusCode: 403,
      code: "cross_tenant_denied",
    });
  }

  const tenant = await app.store.getTenant(resolvedTenantId);
  ensure(tenant, `Unknown tenant ${resolvedTenantId}`, { statusCode: 404, code: "tenant_not_found" });

  const installation = await app.store.getInstallation(resolvedTenantId);
  const scopes = (extra.authInfo?.scopes ?? [
    "crm.read",
    "crm.write",
    "admin.read",
    "admin.write",
    "events.read",
    "tenant.manage",
  ]) as Scope[];
  const actor =
    (typeof extra.authInfo?.extra?.subject === "string" && extra.authInfo.extra.subject) ||
    extra.authInfo?.clientId ||
    app.config.env.LOCAL_ADMIN_ACCOUNT_ID;

  return {
    tenant,
    installation,
    actor,
    clientId: extra.authInfo?.clientId,
    scopes,
    authInfo: extra.authInfo,
  };
};

const requireScopes = (context: ToolExecutionContext, scopes: Scope[]) => {
  for (const scope of scopes) {
    if (!context.scopes.includes(scope)) {
      throw new AppError(`Missing required scope: ${scope}`, {
        statusCode: 403,
        code: "insufficient_scope",
      });
    }
  }
};

const requireConfirm = (confirm: boolean | undefined, message: string) => {
  if (!confirm) {
    throw new AppError(message, {
      statusCode: 400,
      code: "confirmation_required",
    });
  }
};

const collectionEnum = z.enum(["leads", "contacts", "companies", "tasks", "users", "tags"]);
const mutableCollectionEnum = z.enum(["leads", "contacts", "companies", "tasks"]);
const settingsEnum = z.enum(["account", "pipelines", "stages", "custom_fields", "webhooks", "users"]);

const buildSettingsPath = (input: {
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
      return input.resourceId ? `/api/v4/leads/pipelines/${input.resourceId}` : "/api/v4/leads/pipelines";
    case "stages":
      ensure(input.pipelineId, "pipelineId is required for stages", { statusCode: 400, code: "validation_error" });
      return input.resourceId
        ? `/api/v4/leads/pipelines/${input.pipelineId}/statuses/${input.resourceId}`
        : `/api/v4/leads/pipelines/${input.pipelineId}/statuses`;
    case "custom_fields":
      ensure(input.entityType, "entityType is required for custom_fields", {
        statusCode: 400,
        code: "validation_error",
      });
      return input.resourceId
        ? `/api/v4/${input.entityType}/custom_fields/${input.resourceId}`
        : `/api/v4/${input.entityType}/custom_fields`;
    case "webhooks":
      return input.resourceId ? `/api/v4/webhooks/${input.resourceId}` : "/api/v4/webhooks";
  }
};

const handleToolError = (error: unknown) => {
  const safe = toError(error);
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: safe.message,
      },
    ],
  };
};

const buildJsonResult = (label: string, payload: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: `${label}\n${toPrettyJson(payload)}`,
    },
  ],
});

const listResourceUris = async (app: AppContext, extra: Extra) => {
  const tenantIds = parseTenantIds(extra) ?? [app.config.env.DEFAULT_TENANT_ID];
  const uris: Array<{ uri: string; name: string }> = [];

  for (const tenantId of tenantIds) {
    uris.push({ uri: `amocrm://tenant/${tenantId}/account`, name: "account" });
    uris.push({ uri: `amocrm://tenant/${tenantId}/users`, name: "users" });
    uris.push({ uri: `amocrm://tenant/${tenantId}/pipelines`, name: "pipelines" });
    uris.push({ uri: `amocrm://tenant/${tenantId}/custom-fields/leads`, name: "custom-fields-leads" });
    uris.push({ uri: `amocrm://tenant/${tenantId}/events/recent`, name: "recent-events" });
  }

  return uris;
};

const readTenantResource = async (app: AppContext, extra: Extra, tenantId: string, resourceType: string, entityType?: string) => {
  const context = await resolveContext(app, extra, tenantId);

  switch (resourceType) {
    case "account":
      requireScopes(context, ["crm.read"]);
      return await app.amo.getAccount(context.tenant.id);
    case "users":
      requireScopes(context, ["crm.read"]);
      return await app.amo.getEntity(context.tenant.id, "users");
    case "pipelines":
      requireScopes(context, ["admin.read"]);
      return await app.amo.rawRequest(context.tenant.id, "GET", "/api/v4/leads/pipelines");
    case "custom-fields":
      requireScopes(context, ["admin.read"]);
      ensure(entityType, "entityType is required for custom-fields resource", {
        statusCode: 400,
        code: "validation_error",
      });
      return await app.amo.rawRequest(context.tenant.id, "GET", `/api/v4/${entityType}/custom_fields`);
    case "events":
      requireScopes(context, ["events.read"]);
      return { status: 200, data: await app.events.list(context.tenant.id, { limit: 20 }), headers: new Headers() };
    default:
      throw new AppError(`Unsupported resource type ${resourceType}`, { statusCode: 404, code: "resource_not_found" });
  }
};

export const createMcpApplicationServer = (app: AppContext) => {
  const server = new McpServer(
    {
      name: "amocrm-mcp-server",
      version: "0.1.0",
      websiteUrl: app.config.baseUrl.toString(),
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  server.registerTool(
    "crm_search_entities",
    {
      description: "Search or list amoCRM entities with optional filters.",
      inputSchema: {
        tenantId: z.string().optional(),
        entityType: collectionEnum,
        query: maybeJsonRecord,
      },
      annotations: {
        title: "Search amoCRM entities",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ tenantId, entityType, query }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["crm.read"]);
        const response = await app.amo.getEntity(context.tenant.id, entityType, undefined, query);
        return buildJsonResult(`Fetched ${entityType}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "crm_get_entity",
    {
      description: "Fetch a specific amoCRM entity by collection and ID.",
      inputSchema: {
        tenantId: z.string().optional(),
        entityType: collectionEnum,
        entityId: z.string(),
        query: maybeJsonRecord,
      },
      annotations: {
        title: "Get amoCRM entity",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ tenantId, entityType, entityId, query }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["crm.read"]);
        const response = await app.amo.getEntity(context.tenant.id, entityType, entityId, query);
        return buildJsonResult(`Fetched ${entityType}/${entityId}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "crm_upsert_entities",
    {
      description: "Create or update leads, contacts, companies, or tasks.",
      inputSchema: {
        tenantId: z.string().optional(),
        entityType: mutableCollectionEnum,
        mode: z.enum(["create", "update"]).default("create"),
        items: z.array(z.record(z.string(), z.unknown())).min(1),
      },
      annotations: {
        title: "Create or update CRM entities",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ tenantId, entityType, mode, items }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["crm.write"]);
        const response = await app.amo.upsertCollection(context.tenant.id, entityType, items, mode === "create" ? "POST" : "PATCH");
        await app.audit.recordToolAction(context, {
          action: `crm.${mode}.${entityType}`,
          target: `${entityType}:${items.length}`,
          destructive: false,
          metadata: { itemCount: items.length },
        });
        return buildJsonResult(`Upserted ${entityType}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "crm_complete_task",
    {
      description: "Mark a task as completed.",
      inputSchema: {
        tenantId: z.string().optional(),
        taskId: z.string(),
        text: z.string().optional(),
      },
      annotations: {
        title: "Complete task",
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ tenantId, taskId, text }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["crm.write"]);
        const response = await app.amo.completeTask(context.tenant.id, taskId, text);
        await app.audit.recordToolAction(context, {
          action: "crm.complete_task",
          target: `tasks:${taskId}`,
          destructive: false,
        });
        return buildJsonResult(`Completed task ${taskId}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "crm_add_note",
    {
      description: "Attach a note to an amoCRM entity.",
      inputSchema: {
        tenantId: z.string().optional(),
        entityType: z.string(),
        entityId: z.string(),
        noteType: z.string().default("common"),
        params: z.record(z.string(), z.unknown()),
      },
      annotations: {
        title: "Add note",
        openWorldHint: false,
      },
    },
    async ({ tenantId, entityType, entityId, noteType, params }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["crm.write"]);
        const response = await app.amo.addNote(context.tenant.id, entityType, entityId, noteType, params);
        await app.audit.recordToolAction(context, {
          action: "crm.add_note",
          target: `${entityType}:${entityId}`,
          destructive: false,
        });
        return buildJsonResult(`Added note to ${entityType}/${entityId}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "crm_set_tags",
    {
      description: "Replace tags for an amoCRM entity.",
      inputSchema: {
        tenantId: z.string().optional(),
        entityType: z.enum(["leads", "contacts", "companies"]),
        entityId: z.string(),
        tags: z.array(z.string()).min(1),
      },
      annotations: {
        title: "Set tags",
        destructiveHint: false,
      },
    },
    async ({ tenantId, entityType, entityId, tags }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["crm.write"]);
        const response = await app.amo.setTags(context.tenant.id, entityType, entityId, tags);
        await app.audit.recordToolAction(context, {
          action: "crm.set_tags",
          target: `${entityType}:${entityId}`,
          destructive: false,
          metadata: { tags },
        });
        return buildJsonResult(`Updated tags for ${entityType}/${entityId}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "crm_link_entities",
    {
      description: "Create links between amoCRM entities.",
      inputSchema: {
        tenantId: z.string().optional(),
        entityType: z.string(),
        entityId: z.string(),
        links: z.array(
          z.object({
            toEntityType: z.string(),
            toEntityId: z.string(),
          }),
        ),
      },
      annotations: {
        title: "Link entities",
      },
    },
    async ({ tenantId, entityType, entityId, links }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["crm.write"]);
        const response = await app.amo.linkEntities(context.tenant.id, entityType, entityId, links);
        await app.audit.recordToolAction(context, {
          action: "crm.link_entities",
          target: `${entityType}:${entityId}`,
          destructive: false,
        });
        return buildJsonResult(`Linked ${entityType}/${entityId}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "admin_list_settings",
    {
      description: "Read account settings and admin metadata available through amoCRM API.",
      inputSchema: {
        tenantId: z.string().optional(),
        settingType: settingsEnum,
        entityType: z.string().optional(),
        pipelineId: z.string().optional(),
        resourceId: z.string().optional(),
        query: maybeJsonRecord,
      },
      annotations: {
        title: "List admin settings",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ tenantId, settingType, entityType, pipelineId, resourceId, query }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["admin.read"]);
        const path = buildSettingsPath({ settingType, entityType, pipelineId, resourceId });
        const response = await app.amo.rawRequest(context.tenant.id, "GET", path, undefined, query);
        return buildJsonResult(`Fetched ${settingType}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "admin_mutate_settings",
    {
      description: "Create, update, or delete admin settings through curated amoCRM API paths.",
      inputSchema: {
        tenantId: z.string().optional(),
        settingType: z.enum(["pipelines", "stages", "custom_fields", "webhooks"]),
        action: z.enum(["create", "update", "delete"]),
        entityType: z.string().optional(),
        pipelineId: z.string().optional(),
        resourceId: z.string().optional(),
        payload: z.union([z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown()))]).optional(),
        confirm: z.boolean().default(false),
      },
      annotations: {
        title: "Mutate admin settings",
        destructiveHint: true,
        openWorldHint: false,
      },
    },
    async ({ tenantId, settingType, action, entityType, pipelineId, resourceId, payload, confirm }, extra) => {
      try {
        if (!app.config.env.ENABLE_ADMIN_WRITE_TOOLS) {
          throw new AppError("Admin write tools are disabled by configuration", {
            statusCode: 403,
            code: "feature_disabled",
          });
        }

        if (action === "delete") {
          ensure(app.config.env.ENABLE_DELETE_TOOLS, "Delete tools are disabled by configuration", {
            statusCode: 403,
            code: "feature_disabled",
          });
        }

        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["admin.write"]);
        if (action !== "create") {
          requireConfirm(confirm, "confirm=true is required for update and delete admin actions");
        }

        const path = buildSettingsPath({ settingType, entityType, pipelineId, resourceId });
        const method = action === "create" ? "POST" : action === "update" ? "PATCH" : "DELETE";
        const response = await app.amo.rawRequest(context.tenant.id, method, path, payload);
        await app.audit.recordToolAction(context, {
          action: `admin.${action}.${settingType}`,
          target: path,
          destructive: action !== "create",
          metadata: { payload },
        });
        return buildJsonResult(`Admin ${action} ${settingType}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "admin_manage_webhooks",
    {
      description: "Sync the amoCRM webhook subscription for this MCP server.",
      inputSchema: {
        tenantId: z.string().optional(),
        destinationUrl: z.string().url().optional(),
        confirm: z.boolean().default(false),
      },
      annotations: {
        title: "Sync webhooks",
        destructiveHint: true,
      },
    },
    async ({ tenantId, destinationUrl, confirm }, extra) => {
      try {
        ensure(app.config.env.ENABLE_WEBHOOK_MUTATIONS, "Webhook mutations are disabled by configuration", {
          statusCode: 403,
          code: "feature_disabled",
        });

        requireConfirm(confirm, "confirm=true is required to mutate webhook settings");
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["admin.write"]);
        const target = destinationUrl ?? new URL("/webhooks/amocrm", app.config.baseUrl).toString();
        const response = await app.amo.syncWebhookSubscription(context.tenant.id, target);
        await app.audit.recordToolAction(context, {
          action: "admin.sync_webhooks",
          target,
          destructive: true,
        });
        return buildJsonResult(`Synced webhooks to ${target}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "amocrm_raw_request",
    {
      description:
        "Advanced fallback tool for unsupported amoCRM API operations. Requires admin.write for write methods and confirm=true for non-GET requests.",
      inputSchema: {
        tenantId: z.string().optional(),
        method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
        path: z.string(),
        query: maybeJsonRecord,
        body: z.unknown().optional(),
        confirm: z.boolean().default(false),
      },
      annotations: {
        title: "Raw amoCRM API request",
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ tenantId, method, path, query, body, confirm }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, method === "GET" ? ["crm.read"] : ["admin.write"]);
        if (method !== "GET") {
          requireConfirm(confirm, "confirm=true is required for non-GET raw requests");
        }
        const response = await app.amo.rawRequest(context.tenant.id, method, path, body, query);
        await app.audit.recordToolAction(context, {
          action: `raw.${method.toLowerCase()}`,
          target: path,
          destructive: method !== "GET",
        });
        return buildJsonResult(`Executed ${method} ${path}`, response.data);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "events_list",
    {
      description: "List normalized amoCRM webhook events stored by this server.",
      inputSchema: {
        tenantId: z.string().optional(),
        limit: z.number().int().positive().max(100).default(20),
        entityType: z.string().optional(),
        entityId: z.string().optional(),
      },
      annotations: {
        title: "List events",
        readOnlyHint: true,
      },
    },
    async ({ tenantId, limit, entityType, entityId }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["events.read"]);
        const events = await app.events.list(context.tenant.id, { limit, entityType, entityId });
        return buildJsonResult("Recent events", events);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "events_get",
    {
      description: "Fetch a single normalized event by eventId.",
      inputSchema: {
        tenantId: z.string().optional(),
        eventId: z.string(),
      },
      annotations: {
        title: "Get event",
        readOnlyHint: true,
      },
    },
    async ({ tenantId, eventId }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["events.read"]);
        const event = await app.events.get(context.tenant.id, eventId);
        ensure(event, `Event ${eventId} not found`, { statusCode: 404, code: "event_not_found" });
        return buildJsonResult(`Event ${eventId}`, event);
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerTool(
    "events_replay_context",
    {
      description: "Fetch an event plus recent history for the same entity to give AI execution context.",
      inputSchema: {
        tenantId: z.string().optional(),
        eventId: z.string(),
      },
      annotations: {
        title: "Replay event context",
        readOnlyHint: true,
      },
    },
    async ({ tenantId, eventId }, extra) => {
      try {
        const context = await resolveContext(app, extra, tenantId);
        requireScopes(context, ["events.read"]);
        const event = await app.events.get(context.tenant.id, eventId);
        ensure(event, `Event ${eventId} not found`, { statusCode: 404, code: "event_not_found" });
        const related = await app.events.list(context.tenant.id, {
          limit: 10,
          entityType: event.entityType,
          entityId: event.entityId,
        });
        return buildJsonResult(`Replay context for ${eventId}`, {
          event,
          related,
        });
      } catch (error) {
        return handleToolError(error);
      }
    },
  );

  server.registerResource(
    "amocrm-account",
    new ResourceTemplate("amocrm://tenant/{tenantId}/account", {
      list: async (extra) => ({
        resources: (await listResourceUris(app, extra))
          .filter((resource) => resource.name === "account")
          .map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            mimeType: "application/json",
          })),
      }),
    }),
    { mimeType: "application/json" },
    async (_uri, variables, extra) => {
      const response = await readTenantResource(app, extra, String(variables.tenantId), "account");
      return {
        contents: [
          {
            uri: `amocrm://tenant/${variables.tenantId}/account`,
            mimeType: "application/json",
            text: toPrettyJson(response.data),
          },
        ],
      };
    },
  );

  server.registerResource(
    "amocrm-users",
    new ResourceTemplate("amocrm://tenant/{tenantId}/users", {
      list: async (extra) => ({
        resources: (await listResourceUris(app, extra))
          .filter((resource) => resource.name === "users")
          .map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            mimeType: "application/json",
          })),
      }),
    }),
    { mimeType: "application/json" },
    async (_uri, variables, extra) => {
      const response = await readTenantResource(app, extra, String(variables.tenantId), "users");
      return {
        contents: [
          {
            uri: `amocrm://tenant/${variables.tenantId}/users`,
            mimeType: "application/json",
            text: toPrettyJson(response.data),
          },
        ],
      };
    },
  );

  server.registerResource(
    "amocrm-pipelines",
    new ResourceTemplate("amocrm://tenant/{tenantId}/pipelines", {
      list: async (extra) => ({
        resources: (await listResourceUris(app, extra))
          .filter((resource) => resource.name === "pipelines")
          .map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            mimeType: "application/json",
          })),
      }),
    }),
    { mimeType: "application/json" },
    async (_uri, variables, extra) => {
      const response = await readTenantResource(app, extra, String(variables.tenantId), "pipelines");
      return {
        contents: [
          {
            uri: `amocrm://tenant/${variables.tenantId}/pipelines`,
            mimeType: "application/json",
            text: toPrettyJson(response.data),
          },
        ],
      };
    },
  );

  server.registerResource(
    "amocrm-custom-fields",
    new ResourceTemplate("amocrm://tenant/{tenantId}/custom-fields/{entityType}", {
      list: async (extra) => ({
        resources: (await listResourceUris(app, extra))
          .filter((resource) => resource.name === "custom-fields-leads")
          .map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            mimeType: "application/json",
          })),
      }),
    }),
    { mimeType: "application/json" },
    async (_uri, variables, extra) => {
      const tenantId = String(variables.tenantId);
      const entityType = String(variables.entityType);
      const response = await readTenantResource(app, extra, tenantId, "custom-fields", entityType);
      return {
        contents: [
          {
            uri: `amocrm://tenant/${tenantId}/custom-fields/${entityType}`,
            mimeType: "application/json",
            text: toPrettyJson(response.data),
          },
        ],
      };
    },
  );

  server.registerResource(
    "amocrm-recent-events",
    new ResourceTemplate("amocrm://tenant/{tenantId}/events/recent", {
      list: async (extra) => ({
        resources: (await listResourceUris(app, extra))
          .filter((resource) => resource.name === "recent-events")
          .map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            mimeType: "application/json",
          })),
      }),
    }),
    { mimeType: "application/json" },
    async (_uri, variables, extra) => {
      const response = await readTenantResource(app, extra, String(variables.tenantId), "events");
      return {
        contents: [
          {
            uri: `amocrm://tenant/${variables.tenantId}/events/recent`,
            mimeType: "application/json",
            text: toPrettyJson(response.data),
          },
        ],
      };
    },
  );

  return server;
};
