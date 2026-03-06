# MCP Security Gateway — Threat Model

## Scope

This threat model covers the local-dev PoC gateway. Production deployments require additional controls noted in "Remaining Gaps".

## Assets

| Asset | Value |
|---|---|
| Upstream MCP tool execution | High — can read/write files, fetch URLs, run arbitrary logic |
| Actor identity & credentials | High — JWT tokens, upstream auth headers |
| Audit log | Medium — confidentiality of who called what |
| Gateway configuration | High — changing upstreams or policy bypasses all controls |

---

## Key Threats

### T1 — Prompt Injection → Tool Abuse
**Description**: A malicious LLM prompt tricks an agent into calling a dangerous tool (e.g., `writeFile` with attacker-controlled content, or `fetchUrl` to an internal service).

**Attack vector**: The attacker embeds instructions in content the LLM processes (email, webpage, document) that causes the agent to issue tool calls it wouldn't otherwise make.

**Mitigations in this PoC**:
- OPA policy blocks tool calls not in the per-upstream allowlist
- Role-based restrictions prevent `viewer`-role agents from calling write tools
- Dangerous argument pattern detection blocks common shell-injection sequences (`../`, `;`, `&&`, `` ` ``, `$(`)
- All calls are audited with actor identity for post-incident review

**Remaining gaps**:
- Semantic analysis of args not implemented (could pass injection in base64 or unicode)
- No content-inspection of upstream responses for injected instructions

---

### T2 — Data Exfiltration via Tool Response
**Description**: Attacker uses `readFile` or `fetchUrl` to exfiltrate sensitive data through the agent's context window.

**Attack vector**: Agent calls `readFile` on `/etc/passwd`, cloud metadata endpoints, or internal APIs that return secrets.

**Mitigations in this PoC**:
- OPA `redactions` field strips known sensitive field names (`password`, `token`, `secretKey`, `apiKey`) from responses for non-admin actors
- Demo FS upstream sandboxes reads to `./demo-data/` directory
- Path traversal patterns (`../`) are blocked in policy
- Response hash is logged for forensics

**Remaining gaps**:
- Regex-based redaction won't catch novel field names or deeply nested secrets
- No egress filtering on `fetchUrl` targets (no IP allowlist/denylist for private ranges)
- File content is not scanned for secrets (no DLP integration)

---

### T3 — Privilege Escalation
**Description**: A `viewer`-role token is used to perform write operations, or a token is forged/stolen to escalate privileges.

**Attack vector**: Forged JWT, stolen JWT from logs or transit, or RBAC bypass via policy flaw.

**Mitigations in this PoC**:
- JWT is verified with HMAC-SHA256; forged tokens are rejected at auth middleware
- Roles are read from the JWT payload (not from user-supplied request body)
- OPA policy enforces role-based restrictions on write tools
- Short token expiry enforced (configurable, default 1h in generate-jwt script)

**Remaining gaps**:
- Symmetric JWT (HS256) — secret must be kept secure; asymmetric RS256/ES256 preferred for production
- No token revocation (no blocklist); a stolen token is valid until expiry
- JWT roles are trusted as-is; no authoritative identity provider integration

---

### T4 — Denial of Service via Tool Flooding
**Description**: An attacker or runaway agent fires unlimited tool calls, consuming upstream resources or causing billing/cost explosions.

**Attack vector**: Agent loop bug, compromised client, or intentional flood.

**Mitigations in this PoC**:
- In-memory token-bucket rate limiter per `actor:tool` key (default: 10 req/burst, 2/s refill)
- Rate limit violations return 429 and are audit-logged

**Remaining gaps**:
- Rate limiter is in-process (not shared across gateway replicas)
- No global rate limit (per-org, per-upstream)
- Upstream connectors have configurable timeout but no circuit breaker

---

### T5 — Insecure Upstream Communication
**Description**: Gateway forwards calls to an upstream that has been compromised or substituted (SSRF-like).

**Attack vector**: Attacker changes `upstreamId` to a value that resolves to an internal service, or the upstream config is modified.

**Mitigations in this PoC**:
- Upstream registry is loaded from `config/upstreams.yaml` at startup (not user-supplied)
- Client cannot choose an arbitrary URL — only registered `upstreamId` values are accepted
- Unknown `upstreamId` returns 400 immediately

**Remaining gaps**:
- No mTLS or signed upstream requests
- Upstream auth headers stored in plaintext config
- No certificate pinning for upstream connections

---

### T6 — Audit Log Tampering
**Description**: Attacker deletes or modifies audit logs to cover their tracks.

**Attack vector**: Direct SQLite file access, SQL injection via gateway API, or service compromise.

**Mitigations in this PoC**:
- Audit service uses parameterized queries (no SQL injection)
- SQLite WAL mode prevents partial writes
- Admin read endpoint is read-only (SELECT only)

**Remaining gaps**:
- No append-only enforcement on the SQLite file
- No cryptographic chaining of log entries (no Merkle/WORM)
- No SIEM integration or off-host log shipping

---

## Attack Surface Summary

```
External Attack Surface:
  POST /v1/call          ← requires valid JWT; main mediation point
  GET  /health           ← unauthenticated; no sensitive data

Internal Attack Surface:
  GET  /admin/logs       ← authenticated (same JWT); exposes audit data
  SQLite data/audit.db   ← filesystem access; no encryption at rest
  OPA REST API :8181     ← internal only; no auth in dev mode
  Upstream servers       ← internal only; authenticated by config
```

## Control Summary

| Threat | Auth | Policy | Rate Limit | Audit | Sanitize |
|--------|------|--------|------------|-------|---------|
| T1 Prompt injection | ✓ | ✓ | — | ✓ | — |
| T2 Data exfil | ✓ | ✓ | — | ✓ | ✓ |
| T3 Privilege esc. | ✓ | ✓ | — | ✓ | — |
| T4 DoS flood | — | — | ✓ | ✓ | — |
| T5 SSRF | ✓ | ✓ | — | ✓ | — |
| T6 Log tamper | — | — | — | ✓ | — |

## Remaining Gaps (Production Checklist)

- [ ] Switch to RS256/ES256 JWT with public-key verification
- [ ] Integrate with real IdP (Okta, Auth0) for token issuance + revocation
- [ ] Add IP-allowlist/denylist for `fetchUrl` targets (block RFC 1918 ranges)
- [ ] DLP scanning on file contents and upstream responses
- [ ] Semantic argument analysis (LLM-based or regex library)
- [ ] Shared Redis-backed rate limiter for multi-replica deployments
- [ ] Circuit breakers on upstream connectors
- [ ] mTLS between gateway and upstreams
- [ ] Encrypt SQLite at rest (SQLCipher) or migrate to PostgreSQL with row-level security
- [ ] Cryptographic audit log chaining + off-host SIEM shipping
- [ ] OPA bundle signing to prevent policy tampering
- [ ] Add `fetchUrl` egress filtering (block private IP ranges 10.x, 172.16.x, 192.168.x, 169.254.x)
