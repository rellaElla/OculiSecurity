# MCP Security Gateway — How-To Guide

## Prerequisites

- Node.js 20+
- npm 9+
- Docker + Docker Compose (for full stack with OPA)
- `curl` or any HTTP client

---

## Quick Start (Local Dev, No Docker)

### 1. Install Dependencies

```bash
./scripts/setup.sh
```

Or manually:
```bash
cd apps/gateway && npm install
cd apps/demo-upstream-fs && npm install
cd apps/demo-upstream-http && npm install
```

### 2. Mint a JWT

```bash
# Default: editor role, 1 hour expiry
node scripts/generate-jwt.mjs

# Custom actor/role
node scripts/generate-jwt.mjs --actor alice --org my-org --roles admin --expiry 24h

# Viewer role (for testing deny scenarios)
node scripts/generate-jwt.mjs --actor bob --roles viewer
```

Copy the printed token.

### 3. Start Upstreams + Gateway

Terminal 1 — FS upstream:
```bash
cd apps/demo-upstream-fs && npm run dev
```

Terminal 2 — HTTP upstream:
```bash
cd apps/demo-upstream-http && npm run dev
```

Terminal 3 — Gateway (OPA disabled, using built-in policy):
```bash
cd apps/gateway && OPA_ENABLED=false npm run dev
```

### 4. Try a Call

```bash
TOKEN="<paste your JWT here>"

curl -s -X POST http://localhost:3000/v1/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"hello.txt"}}' \
  | jq .
```

---

## Full Stack with Docker Compose

### Start Everything

```bash
docker compose up --build
```

This starts:
- `gateway` on port 3000
- `demo-upstream-fs` on port 3001
- `demo-upstream-http` on port 3002
- `opa` on port 8181 (internal to Docker network)

### Mint a JWT (docker variant)

```bash
docker compose exec gateway node /app/scripts/generate-jwt.mjs
```

Or run the script locally (it only uses npm packages):
```bash
node scripts/generate-jwt.mjs
```

### Check OPA is Working

```bash
curl http://localhost:8181/health
# {"healthy": true}
```

Test OPA policy directly:
```bash
curl -s -X POST http://localhost:8181/v1/data/gateway/authz \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "actor": "alice",
      "orgId": "org-1",
      "roles": ["editor"],
      "upstreamId": "fs-server",
      "tool": "readFile",
      "args": {"path": "hello.txt"},
      "time": "2024-01-01T00:00:00Z",
      "ip": "127.0.0.1",
      "sessionId": "test"
    }
  }' | jq .result
```

---

## Example Curl Commands

See `scripts/curl-examples.sh` for a full set. Quick reference:

### Allowed: readFile as editor
```bash
TOKEN=$(node scripts/generate-jwt.mjs --actor alice --roles editor --silent)
curl -s -X POST http://localhost:3000/v1/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"hello.txt"}}' | jq .
```

### Denied: writeFile as viewer (role restriction)
```bash
TOKEN=$(node scripts/generate-jwt.mjs --actor bob --roles viewer --silent)
curl -s -X POST http://localhost:3000/v1/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"writeFile","args":{"path":"out.txt","content":"pwned"}}' | jq .
```

### Denied: readFile with path traversal
```bash
TOKEN=$(node scripts/generate-jwt.mjs --actor alice --roles editor --silent)
curl -s -X POST http://localhost:3000/v1/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"upstreamId":"fs-server","tool":"readFile","args":{"path":"../../../etc/passwd"}}' | jq .
```

---

## Admin UI

Open `http://localhost:3000/admin` in your browser. Paste a JWT, pick an upstream/tool, enter args, and click "Run Call".

## Audit Logs

```bash
# Recent 20 entries via API
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/admin/logs | jq .

# Or query SQLite directly
sqlite3 apps/gateway/data/audit.db \
  "SELECT timestamp, actor, tool, decision, reason FROM audit_logs ORDER BY timestamp DESC LIMIT 20;"
```

---

## Running Tests

```bash
cd apps/gateway

# All tests (OPA_ENABLED=false uses built-in policy)
OPA_ENABLED=false npm test

# Watch mode
OPA_ENABLED=false npm run test:watch

# With coverage
OPA_ENABLED=false npm run test:coverage
```

---

## Adding a New Upstream

1. Edit `apps/gateway/config/upstreams.yaml`:
```yaml
upstreams:
  - id: my-new-server
    name: My New MCP Server
    baseUrl: http://localhost:3003
    timeout: 5000
```

2. Add tools to OPA policy (`policies/gateway.rego`):
```rego
tool_allowlists := {
    "fs-server":      {"readFile", "listDir", "writeFile"},
    "http-server":    {"fetchUrl", "postUrl"},
    "my-new-server":  {"myTool1", "myTool2"},   # <-- add this
}
```

3. Reload OPA (or restart gateway if using built-in policy).

---

## Adding a New Policy Rule

Edit `policies/gateway.rego`. Example — block calls outside business hours:

```rego
import future.keywords.if

after_hours if {
    hour := time.clock(time.now_ns())[0]
    hour >= 18  # after 6pm
}

after_hours if {
    hour := time.clock(time.now_ns())[0]
    hour < 8   # before 8am
}

# Add to the allow rule
allow if {
    not missing_tool
    tool_allowed
    not dangerous_args
    not role_restricted
    not after_hours         # <-- add this line
}
```

Then update the reason chain similarly.

---

## Environment Variables Reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Gateway listen port |
| `JWT_SECRET` | `dev-secret-...` | HMAC secret for JWT verification |
| `OPA_URL` | `http://localhost:8181` | OPA server URL |
| `OPA_ENABLED` | `true` | Set `false` to use built-in policy |
| `DB_PATH` | `./data/audit.db` | SQLite audit database path |
| `STORE_FULL_ARGS` | `false` | Store raw args JSON in audit log |
| `RATE_LIMIT_CAPACITY` | `10` | Token bucket capacity |
| `RATE_LIMIT_REFILL` | `2` | Token refill per second |
| `LOG_LEVEL` | `info` | Fastify log level |
| `FS_SERVER_URL` | `http://localhost:3001` | FS upstream base URL |
| `HTTP_SERVER_URL` | `http://localhost:3002` | HTTP upstream base URL |
| `FS_DEMO_DATA_DIR` | `./demo-data` | Sandbox dir for FS upstream |
| `HTTP_FETCH_TIMEOUT` | `10000` | Timeout for fetchUrl (ms) |
