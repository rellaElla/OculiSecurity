# MCP Security Gateway — Architecture

## Overview

The MCP Security Gateway is a **policy-enforcing reverse proxy** that sits between agent clients and upstream MCP (Model Context Protocol) servers. Every tool call must pass authentication, policy evaluation, and rate limiting before being forwarded.

```
┌────────────────────────────────────────────────────────────────────┐
│                         Agent Client                               │
│  (OpenClaw / curl / Admin UI / any MCP client)                     │
└──────────────────────────────┬─────────────────────────────────────┘
                               │  POST /v1/call
                               │  Authorization: Bearer <JWT>
                               ▼
┌────────────────────────────────────────────────────────────────────┐
│                    MCP SECURITY GATEWAY (port 3000)                │
│                                                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐   │
│  │  JWT Auth    │──▶│  Rate Limit  │──▶│  OPA Policy Engine   │   │
│  │  Middleware  │   │  (in-memory  │   │  (rego / fallback)   │   │
│  └──────────────┘   │  token bucket│   └──────────┬───────────┘   │
│                     └──────────────┘              │ decision       │
│                                                   ▼                │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                   Call Router                               │  │
│  │   allow → sanitize args → proxy to upstream                 │  │
│  │   deny  → return 403 + audit log                           │  │
│  └──────────────────────────┬────────────────────────────────┘   │
│                              │                                     │
│  ┌───────────────────────────▼─────────────────────────────────┐  │
│  │                   Audit Logger (SQLite)                     │  │
│  │   timestamp, actor, tool, args_hash, decision, latency_ms  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└──────────────────┬─────────────────────────────────────────────────┘
                   │  forward (if allowed)
         ┌─────────┴──────────┐
         ▼                    ▼
┌─────────────────┐  ┌─────────────────┐
│  demo-fs-server │  │ demo-http-server│
│  (port 3001)    │  │  (port 3002)    │
│                 │  │                 │
│  readFile       │  │  fetchUrl       │
│  listDir        │  │  postUrl        │
│  writeFile      │  │                 │
└─────────────────┘  └─────────────────┘
         │
         ▼ (separate container)
┌─────────────────┐
│   OPA Server    │
│   (port 8181)   │
│  gateway.rego   │
└─────────────────┘
```

## Components

### 1. Gateway (`apps/gateway`)
- **Runtime**: Node 20+ / TypeScript
- **Framework**: Fastify (fast, schema-validated, plugin-friendly)
- **Entrypoint**: `src/index.ts` → `src/server.ts`

#### Key Modules
| Module | Purpose |
|---|---|
| `middleware/auth.ts` | Verifies JWT, extracts actor/orgId/roles, 401 on failure |
| `services/ratelimit.ts` | Token-bucket rate limiter keyed on `actor:tool` |
| `services/policy.ts` | Calls OPA REST API; falls back to built-in engine |
| `services/audit.ts` | Appends to SQLite `audit_logs` table |
| `services/upstream.ts` | Looks up upstream by id, forwards call via HTTP |
| `services/sanitizer.ts` | Applies redactions/transforms to upstream response |
| `routes/call.ts` | `POST /v1/call` — main call mediation handler |
| `routes/health.ts` | `GET /health` — liveness probe |
| `routes/admin.ts` | `GET /admin/logs` — recent audit log |

### 2. Demo Upstream: Filesystem (`apps/demo-upstream-fs`)
Accepts `POST /v1/call` with `{ tool, args }`. Implements:
- `readFile({ path })` — reads from `./demo-data/` sandbox
- `listDir({ path })` — lists sandbox directory
- `writeFile({ path, content })` — writes to `./demo-data/` sandbox

Path traversal is blocked at the upstream too (defence-in-depth).

### 3. Demo Upstream: HTTP Fetch (`apps/demo-upstream-http`)
- `fetchUrl({ url })` — HTTP GET to external URL
- `postUrl({ url, body })` — HTTP POST to external URL

### 4. OPA (`policies/`)
- `gateway.rego` — main policy: allowlist, dangerous-args, role-restriction, redactions
- `data.json` — static data (custom per-org overrides possible)
- OPA runs as a sidecar container on port 8181

### 5. SQLite Audit Store
Schema (table `audit_logs`):
```
id | requestId | timestamp | actor | orgId | upstreamId | tool
   | argsHash  | argsJson? | decision | reason | latencyMs
   | outcome   | responseHash | ip | sessionId
```
`STORE_FULL_ARGS=true` also stores raw JSON (off by default to protect sensitive data).

## Request Lifecycle

```
1. Client sends POST /v1/call with Bearer JWT
2. auth middleware:
     - verify JWT signature & expiry → 401 if invalid
     - extract { actor, orgId, roles, sub }
3. rate limiter:
     - check token bucket for actor:tool
     - 429 if exhausted
4. policy engine:
     - build PolicyInput (actor, orgId, roles, upstreamId, tool, args, time, ip, sessionId)
     - call OPA POST /v1/data/gateway/authz  (or fallback)
     - receive { allow, reason, redactions, transforms, maxArgsSize }
5. if deny:
     - audit log (decision=deny, outcome=denied)
     - return 403 { requestId, decision, error }
6. if allow:
     - validate args size <= maxArgsSize
     - look up upstream config by upstreamId
     - forward POST to upstream.baseUrl/v1/call
     - receive result or upstream error
     - sanitize response (apply redactions, transforms)
     - audit log (decision=allow, outcome=success|error)
     - return 200 { requestId, decision, upstream, result }
```

## Configuration

All config via environment variables + `config/upstreams.yaml`.

Key env vars:
```
PORT=3000
JWT_SECRET=<min 32 chars>
OPA_URL=http://opa:8181
OPA_ENABLED=true
DB_PATH=./data/audit.db
STORE_FULL_ARGS=false
RATE_LIMIT_CAPACITY=10
RATE_LIMIT_REFILL=2
LOG_LEVEL=info
```

## Extension Points

- **New upstream**: add entry to `config/upstreams.yaml`
- **New policy rule**: edit `policies/gateway.rego` and reload OPA
- **New MCP transport**: replace `services/upstream.ts` HTTP call with WebSocket/stdio adapter
- **Database backend**: swap `audit.ts` implementation (PostgreSQL, etc.)
