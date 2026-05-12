import { AuthenticatedActor } from '../types';
import { PolicyService } from './policy';
import { AuditService } from './audit';
import { UpstreamConnector } from './upstream';
import { RateLimiter } from './ratelimit';
export interface ToolExecutorContext {
    policy: PolicyService;
    audit: AuditService;
    upstream: UpstreamConnector;
    rateLimiter: RateLimiter;
}
export interface ExecuteToolInput {
    actor: AuthenticatedActor;
    upstreamId: string;
    tool: string;
    args: Record<string, unknown>;
    sessionId?: string;
    ip: string;
}
export type ExecuteToolResult = {
    kind: 'allow';
    requestId: string;
    result: unknown;
    upstreamId: string;
    latencyMs: number;
    reason: string;
} | {
    kind: 'deny';
    requestId: string;
    reason: string;
    httpStatus: 400 | 403 | 413 | 429;
    retryAfterMs?: number;
} | {
    kind: 'error';
    requestId: string;
    message: string;
    httpStatus: number;
    upstreamId: string;
    latencyMs: number;
    reason: string;
};
export declare class ToolExecutor {
    private readonly ctx;
    constructor(ctx: ToolExecutorContext);
    execute(input: ExecuteToolInput): Promise<ExecuteToolResult>;
}
