export interface JWTPayload {
    sub: string;
    actor: string;
    orgId: string;
    roles: string[];
    iat: number;
    exp: number;
}
export interface AuthenticatedActor {
    sub: string;
    actor: string;
    orgId: string;
    roles: string[];
}
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
/** Input sent to OPA (or fallback policy engine) */
export interface PolicyInput {
    actor: string;
    orgId: string;
    roles: string[];
    upstreamId: string;
    tool: string;
    args: Record<string, unknown>;
    time: string;
    ip: string;
    sessionId: string;
}
/** Decision returned by OPA / fallback */
export interface PolicyDecision {
    allow: boolean;
    reason: string;
    redactions?: Record<string, boolean>;
    transforms?: Record<string, Transform>;
    maxArgsSize?: number;
}
export interface Transform {
    type: 'truncate' | 'mask' | 'remove';
    maxLength?: number;
    mask?: string;
}
export interface UpstreamConfig {
    id: string;
    name: string;
    baseUrl: string;
    authHeader?: string;
    timeout: number;
    tools?: string[];
}
/** Body forwarded to the upstream MCP server */
export interface UpstreamCallRequest {
    tool: string;
    args: Record<string, unknown>;
    sessionId: string;
    actor: string;
}
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
export interface AuditRecord {
    id?: number;
    requestId: string;
    timestamp: string;
    actor: string;
    orgId: string;
    upstreamId: string;
    tool: string;
    argsHash: string;
    argsJson?: string | null;
    decision: 'allow' | 'deny';
    reason: string;
    latencyMs: number;
    outcome: 'success' | 'error' | 'denied';
    responseHash?: string | null;
    responseJson?: string | null;
    ip: string;
    sessionId: string;
}
