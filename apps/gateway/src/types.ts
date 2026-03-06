// Core domain types for the Oculi Security Gateway

// ---------------------------------------------------------------------------
// JWT / Identity
// ---------------------------------------------------------------------------

export interface JWTPayload {
  sub: string;
  actor: string;
  orgId: string;
  roles: string[];
  iat: number;
  exp: number;
}

// Attached to every Fastify request after auth middleware runs
export interface AuthenticatedActor {
  sub: string;
  actor: string;
  orgId: string;
  roles: string[];
}

// ---------------------------------------------------------------------------
// API Contracts
// ---------------------------------------------------------------------------

/** POST /v1/call — incoming request body */
export interface CallRequest {
  upstreamId: string;
  tool: string;
  args: Record<string, unknown>;
  sessionId?: string;
}

/** Structured response from the gateway */
export interface GatewayResponse {
  requestId: string;
  decision: {
    allow: boolean;
    reason: string;
  };
  upstream?: {
    id: string;
    latencyMs: number;
  };
  result?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** Input sent to OPA (or fallback policy engine) */
export interface PolicyInput {
  actor: string;
  orgId: string;
  roles: string[];
  upstreamId: string;
  tool: string;
  args: Record<string, unknown>;
  time: string;        // ISO 8601
  ip: string;
  sessionId: string;
}

/** Decision returned by OPA / fallback */
export interface PolicyDecision {
  allow: boolean;
  reason: string;
  redactions?: Record<string, boolean>;  // field names to strip from response
  transforms?: Record<string, Transform>; // field-level transforms
  maxArgsSize?: number;                   // max serialised args bytes
}

export interface Transform {
  type: 'truncate' | 'mask' | 'remove';
  maxLength?: number;   // for truncate
  mask?: string;        // replacement string for mask
}

// ---------------------------------------------------------------------------
// Upstream
// ---------------------------------------------------------------------------

export interface UpstreamConfig {
  id: string;
  name: string;
  baseUrl: string;       // resolved URL (env-var substitution done at load time)
  authHeader?: string;   // optional "Bearer <token>" forwarded to upstream
  timeout: number;       // ms
  tools?: string[];      // tool names exposed via MCP / OpenAI surfaces (defaults to [])
}

/** Body forwarded to the upstream MCP server */
export interface UpstreamCallRequest {
  tool: string;
  args: Record<string, unknown>;
  sessionId: string;
  actor: string;
}

// ---------------------------------------------------------------------------
// Telemetry Ingestion
// ---------------------------------------------------------------------------

/** A single tool-call event reported by an external agent */
export interface TelemetryEvent {
  tool: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs?: number;
  timestamp?: string;
  actor?: string;
  sessionId?: string;
  meta?: Record<string, unknown>;
}

/** POST /v1/events — batch of events from an agent */
export interface TelemetryPayload {
  source: string;
  orgId?: string;
  events: TelemetryEvent[];
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface AuditRecord {
  id?: number;
  requestId: string;
  timestamp: string;       // ISO 8601
  actor: string;
  orgId: string;
  upstreamId: string;
  tool: string;
  argsHash: string;        // SHA-256 prefix of serialised args
  argsJson?: string | null;      // full JSON if STORE_FULL_ARGS=true
  decision: 'allow' | 'deny';
  reason: string;
  latencyMs: number;
  outcome: 'success' | 'error' | 'denied';
  responseHash?: string | null;
  responseJson?: string | null;  // truncated response JSON (max 8 KB)
  ip: string;
  sessionId: string;
}
