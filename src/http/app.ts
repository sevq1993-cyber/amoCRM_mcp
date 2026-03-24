import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import middie from "@fastify/middie";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { FastifyRequest } from "fastify";
import { verifyBearerToken } from "../auth/http-auth.js";
import { parseAmoWebhookBody } from "../events/webhook-parser.js";
import { createMcpApplicationServer } from "../mcp/server.js";
import type { AppContext } from "../runtime/app-context.js";
import { AppError } from "../utils/errors.js";

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: ReturnType<typeof createMcpApplicationServer>;
};

const shouldHandleOidc = (path: string): boolean =>
  path === "/auth" ||
  path === "/token" ||
  path === "/jwks" ||
  path === "/.well-known/openid-configuration" ||
  path.startsWith("/interaction/") ||
  path.startsWith("/auth/") ||
  path.startsWith("/session/");

const requireRequestScope = (request: FastifyRequest, scope: string) => {
  if (!request.authInfo?.scopes.includes(scope)) {
    throw new AppError(`Missing required scope ${scope}`, {
      statusCode: 403,
      code: "insufficient_scope",
    });
  }
};

const renderDashboard = async (appContext: AppContext) => {
  const tenants = await appContext.store.listTenants();
  const clients = await appContext.store.listClientRegistrations();
  const events = await appContext.store.listEvents(appContext.config.env.DEFAULT_TENANT_ID, { limit: 10 });
  const audit = await appContext.store.listAuditRecords(appContext.config.env.DEFAULT_TENANT_ID, 10);
  const installation = await appContext.store.getInstallation(appContext.config.env.DEFAULT_TENANT_ID);

  const card = (title: string, body: string) => `
    <section class="card">
      <h2>${title}</h2>
      ${body}
    </section>
  `;

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>amoCRM MCP Dashboard</title>
      <style>
        :root {
          --bg: #f3efe7;
          --panel: rgba(255,255,255,0.9);
          --text: #112024;
          --muted: #5a6d73;
          --accent: #0d8a72;
          --border: rgba(17,32,36,0.08);
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
          background:
            radial-gradient(circle at top left, rgba(13,138,114,0.18), transparent 30%),
            linear-gradient(180deg, #f8f5ef 0%, var(--bg) 100%);
          color: var(--text);
        }
        .wrap { max-width: 1200px; margin: 0 auto; padding: 32px 20px 60px; }
        .hero {
          padding: 24px;
          border-radius: 24px;
          background: linear-gradient(135deg, rgba(13,138,114,0.95), rgba(17,32,36,0.95));
          color: white;
          box-shadow: 0 24px 60px rgba(17,32,36,0.18);
        }
        .hero p { margin: 8px 0 0; max-width: 760px; color: rgba(255,255,255,0.82); }
        .grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 18px;
          margin-top: 22px;
        }
        .card {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 20px;
          padding: 18px;
          backdrop-filter: blur(12px);
          box-shadow: 0 12px 30px rgba(17,32,36,0.08);
        }
        .card h2 { margin: 0 0 12px; font-size: 18px; }
        pre {
          margin: 0;
          padding: 12px;
          border-radius: 14px;
          background: #10272b;
          color: #dbf7ea;
          overflow: auto;
          font-size: 12px;
        }
        ul { margin: 0; padding-left: 18px; }
        li { margin-bottom: 8px; }
        .pill {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(13,138,114,0.14);
          color: var(--accent);
          font-size: 12px;
          margin-right: 8px;
        }
        .muted { color: var(--muted); }
        a { color: var(--accent); text-decoration: none; }
      </style>
    </head>
    <body>
      <main class="wrap">
        <section class="hero">
          <div class="pill">Local Dashboard</div>
          <div class="pill">${appContext.config.baseUrl.toString()}</div>
          <h1>amoCRM MCP Server</h1>
          <p>На этой странице видно текущее состояние локальной сборки: tenants, OAuth clients, подключение amoCRM, последние webhook events, audit trail и ключевые endpoints.</p>
        </section>

        <section class="grid">
          ${card(
            "System",
            `<ul>
              <li><strong>MCP endpoint:</strong> <code>${appContext.config.mcpUrl.toString()}</code></li>
              <li><strong>OIDC issuer:</strong> <code>${appContext.config.issuerUrl.toString()}</code></li>
              <li><strong>amoCRM callback:</strong> <code>${appContext.config.amoRedirectUri}</code></li>
              <li><strong>Storage mode:</strong> ${appContext.config.env.POSTGRES_URL ? "PostgreSQL" : "In-memory local mode"}</li>
            </ul>`,
          )}
          ${card(
            "Tenants",
            `<pre>${JSON.stringify(tenants, null, 2)}</pre>`,
          )}
          ${card(
            "amoCRM Installation",
            installation
              ? `<pre>${JSON.stringify(installation, null, 2)}</pre>`
              : `<p class="muted">amoCRM integration is not configured yet. Set <code>AMO_INTEGRATION_ID</code>, <code>AMO_CLIENT_SECRET</code> and open the OAuth callback flow.</p>`,
          )}
          ${card(
            "OAuth Clients",
            `<pre>${JSON.stringify(clients, null, 2)}</pre>`,
          )}
          ${card(
            "Recent Events",
            `<pre>${JSON.stringify(events, null, 2)}</pre>`,
          )}
          ${card(
            "Audit Trail",
            `<pre>${JSON.stringify(audit, null, 2)}</pre>`,
          )}
          ${card(
            "Quick Links",
            `<ul>
              <li><a href="/healthz">/healthz</a></li>
              <li><a href="/readyz">/readyz</a></li>
              <li><a href="/.well-known/openid-configuration">/.well-known/openid-configuration</a></li>
              <li><a href="${appContext.config.oauthProtectedResourceMetadataPath}">${appContext.config.oauthProtectedResourceMetadataPath}</a></li>
            </ul>`,
          )}
        </section>
      </main>
    </body>
  </html>`;
};

export const createHttpApp = async (appContext: AppContext) => {
  const app = Fastify({
    logger: false,
  });
  const sessions = new Map<string, SessionEntry>();
  const bearer = verifyBearerToken(appContext.oidc);

  await app.register(cors, { origin: true });
  await app.register(formbody);
  await app.register(middie);

  app.use((req, res, next) => {
    const path = req.url?.split("?")[0] ?? "/";
    if (!shouldHandleOidc(path)) {
      next();
      return;
    }

    appContext.oidc.callback(req, res);
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    appContext.logger.error(
      {
        err: error,
        url: request.url,
        requestId: request.id,
      },
      "http request failed",
    );
    void reply.code(statusCode).send({
      error: error instanceof AppError ? error.code : "internal_error",
      message: error instanceof Error ? error.message : "Internal error",
    });
  });

  app.get("/", async (_request, reply) => {
    await reply.redirect("/dashboard");
  });

  app.get("/dashboard", async (_request, reply) => {
    const html = await renderDashboard(appContext);
    reply.type("text/html").send(html);
  });

  app.get("/healthz", async () => ({
    status: "ok",
    time: new Date().toISOString(),
  }));

  app.get("/readyz", async () => ({
    status: "ready",
    storage: appContext.config.env.POSTGRES_URL ? "postgres" : "memory",
    redis: Boolean(appContext.config.env.REDIS_URL),
  }));

  app.get("/.well-known/oauth-authorization-server", async () => {
    return appContext.oidc.buildAuthorizationServerMetadata();
  });

  app.get(appContext.config.oauthProtectedResourceMetadataPath, async () => {
    return appContext.oidc.buildProtectedResourceMetadata();
  });

  app.all("/authorize", async (request, reply) => {
    const query = request.url.includes("?") ? request.url.slice(request.url.indexOf("?")) : "";
    await reply.redirect(`/auth${query}`);
  });

  app.get("/oauth/amocrm/callback", async (request) => {
    const query = request.query as { code?: string; tenantId?: string };
    if (!query.code) {
      throw new AppError("Missing amoCRM authorization code", { statusCode: 400, code: "validation_error" });
    }

    const result = await appContext.amo.exchangeAuthorizationCode(
      query.tenantId ?? appContext.config.env.DEFAULT_TENANT_ID,
      query.code,
    );

    return {
      status: "connected",
      tenantId: result.tenantId,
      baseDomain: result.installation.baseDomain,
      expiresAt: result.installation.tokens?.expiresAt,
    };
  });

  app.post("/webhooks/amocrm", async (request) => {
    const tenantId = (request.query as { tenantId?: string }).tenantId ?? appContext.config.env.DEFAULT_TENANT_ID;
    const installation = await appContext.store.getInstallation(tenantId);
    const parsed = parseAmoWebhookBody(
      tenantId,
      (request.body as Record<string, unknown>) ?? {},
      installation?.accountId,
    );
    const accepted = await appContext.events.ingest(parsed.events);

    return {
      accepted: accepted.length,
      dropped: parsed.events.length - accepted.length,
      events: accepted,
    };
  });

  app.get("/admin/tenants/:id/install-status", { preHandler: bearer }, async (request) => {
    requireRequestScope(request, "tenant.manage");
    const tenantId = (request.params as { id: string }).id;
    return {
      tenant: await appContext.store.getTenant(tenantId),
      installation: await appContext.store.getInstallation(tenantId),
      events: await appContext.store.listEvents(tenantId, { limit: 5 }),
      audit: await appContext.store.listAuditRecords(tenantId, 5),
    };
  });

  app.post("/admin/tenants/:id/webhooks/sync", { preHandler: bearer }, async (request) => {
    requireRequestScope(request, "admin.write");
    const tenantId = (request.params as { id: string }).id;
    const destinationUrl =
      ((request.body as { destinationUrl?: string } | undefined)?.destinationUrl) ??
      new URL("/webhooks/amocrm", appContext.config.baseUrl).toString();
    const result = await appContext.amo.syncWebhookSubscription(tenantId, destinationUrl);
    return {
      destinationUrl,
      result: result.data,
    };
  });

  const handleMcpRequest = async (request: FastifyRequest, reply: any) => {
    const sessionHeader = request.headers["mcp-session-id"];
    const sessionId = typeof sessionHeader === "string" ? sessionHeader : undefined;
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    if (!entry) {
      if (request.method !== "POST" || !isInitializeRequest(request.body)) {
        reply.code(400).send({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Bad Request: initialize over POST is required for a new session",
          },
          id: null,
        });
        return;
      }

      const server = createMcpApplicationServer(appContext);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, {
            server,
            transport,
          });
        },
        onsessionclosed: async (closedSessionId) => {
          const closed = sessions.get(closedSessionId);
          sessions.delete(closedSessionId);
          if (closed) {
            await closed.server.close();
          }
        },
      });
      await server.connect(transport);
      entry = { server, transport };
    }

    reply.hijack();
    await entry.transport.handleRequest(request.raw, reply.raw, request.body);
  };

  app.route({
    method: ["GET", "POST", "DELETE"],
    url: appContext.config.env.MCP_HTTP_PATH,
    preHandler: bearer,
    handler: handleMcpRequest,
  });

  return app;
};
