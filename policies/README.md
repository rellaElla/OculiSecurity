# Gateway OPA Policies

## Files

| File | Purpose |
|---|---|
| `gateway.rego` | Main policy: allowlist, dangerous-args, role-restriction, redactions |
| `data.json` | Static data bundle (extend with per-org overrides) |

## Policy Package

`package gateway.authz`

## Inputs

The gateway sends this input object to OPA:

```json
{
  "actor":      "alice",
  "orgId":      "org-abc",
  "roles":      ["editor"],
  "upstreamId": "fs-server",
  "tool":       "readFile",
  "args":       { "path": "hello.txt" },
  "time":       "2024-01-15T10:30:00.000Z",
  "ip":         "127.0.0.1",
  "sessionId":  "session-xyz"
}
```

## Outputs

```json
{
  "allow":        true,
  "reason":       "allowed",
  "redactions":   {},
  "max_args_size": 102400
}
```

| Field | Type | Description |
|---|---|---|
| `allow` | bool | Whether to forward the call |
| `reason` | string | Human-readable explanation |
| `redactions` | object | Keys to strip from upstream response |
| `max_args_size` | number | Max args payload in bytes |

## Rules

### Tool Allowlist
Each upstream has a fixed set of allowed tools. Calls to unlisted tools are denied.

```
fs-server:   { readFile, listDir, writeFile }
http-server: { fetchUrl, postUrl }
```

### Dangerous Argument Patterns
Any string argument containing these patterns is blocked:
- `../` `..\\` — path traversal
- `;` `&&` `||` `` ` `` `$(` `${` — shell injection
- `%2e%2e` `%252e` — URL-encoded traversal

### Role Restrictions
Write tools (`writeFile`, `postUrl`) require `editor` or `admin` role. `viewer` is denied.

### Redactions
Non-admin actors have these fields stripped from upstream responses:
`secretKey`, `password`, `token`, `apiKey`, `secret`, `privateKey`

## Testing OPA Locally

```bash
# Install OPA CLI
brew install opa   # macOS

# Test the policy
opa eval --data policies/gateway.rego --data policies/data.json \
  --input - 'data.gateway.authz' <<'EOF'
{
  "actor": "alice",
  "orgId": "org-1",
  "roles": ["editor"],
  "upstreamId": "fs-server",
  "tool": "readFile",
  "args": {"path": "hello.txt"},
  "time": "2024-01-01T00:00:00Z",
  "ip": "127.0.0.1",
  "sessionId": "s1"
}
EOF

# Run OPA unit tests
opa test policies/ -v
```

## Extending the Policy

### Add a new upstream's allowlist
```rego
tool_allowlists := {
    "fs-server":      {"readFile", "listDir", "writeFile"},
    "http-server":    {"fetchUrl", "postUrl"},
    "my-new-server":  {"myTool1", "myTool2"},   # add here
}
```

### Block a specific actor
```rego
allow if {
    not missing_tool
    tool_allowed
    not dangerous_args
    not role_restricted
    not actor_blocked          # add this
}

actor_blocked if {
    input.actor in data.blocked_actors
}
```

Then add actors to `data.json`:
```json
{ "blocked_actors": ["bad-actor-123"] }
```

### Add time-of-day restriction
```rego
after_hours if {
    hour := time.clock(time.now_ns())[0]
    hour >= 18
}
```
