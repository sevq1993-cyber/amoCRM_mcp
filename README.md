# amoCRM MCP Server

Multi-tenant-ready MCP server for amoCRM with:

- `stdio` transport for local agents
- `Streamable HTTP` transport for remote MCP clients
- built-in local OIDC/OAuth shell for MCP auth
- amoCRM OAuth install/refresh flow
- webhook ingestion and normalized event store
- local dashboard at `/dashboard`

## Local Start

1. Copy `.env.example` into `.env` and fill in amoCRM credentials when ready.
2. Install dependencies:

```bash
npm install
```

3. Start HTTP mode:

```bash
npm run dev:http
```

4. Open the dashboard:

```text
http://localhost:3000/dashboard
```

## Useful Endpoints

- Dashboard: `http://localhost:3000/dashboard`
- MCP HTTP: `http://localhost:3000/mcp`
- Health: `http://localhost:3000/healthz`
- Readiness: `http://localhost:3000/readyz`
- OIDC discovery: `http://localhost:3000/.well-known/openid-configuration`
- Protected resource metadata: `http://localhost:3000/.well-known/oauth-protected-resource/mcp`
- amoCRM callback: `http://localhost:3000/oauth/amocrm/callback`

## Local Defaults

- Default tenant: `local-default`
- Local admin account id for OIDC dev interactions: `local-admin`
- Default confidential OAuth client:
  - `client_id`: `local-dev-client`
  - `client_secret`: `local-dev-secret`
  - `redirect_uri`: `http://127.0.0.1:8787/callback`

## Scripts

```bash
npm run dev:http
npm run dev:stdio
npm run build
npm run start:http
npm run start:stdio
npm run check
npm run test
```

## Current Storage Modes

- Default local mode: in-memory store + in-memory cache
- Optional server mode: PostgreSQL + Redis through `POSTGRES_URL` and `REDIS_URL`

## Important Local-Only Notes

This build intentionally keeps the auth and persistence defaults easy for local development.

- `oidc-provider` still uses development interactions and in-memory state by default.
- Signing keys are development keys unless you replace them in the OIDC config.
- For real deployment, replace the local OIDC defaults, externalize secrets, and use PostgreSQL + Redis.

## Docker

Build app image:

```bash
docker build -t amocrm-mcp .
```

Optional local infra:

```bash
docker compose up -d postgres redis
```
