"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolExecutor = void 0;
const uuid_1 = require("uuid");
const upstream_1 = require("./upstream");
const sanitizer_1 = require("./sanitizer");
// ---------------------------------------------------------------------------
// ToolExecutor — shared 7-step pipeline (validate → rate-limit → policy →
// size-check → forward → sanitize → audit)
// ---------------------------------------------------------------------------
class ToolExecutor {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    async execute(input) {
        const requestId = (0, uuid_1.v4)();
        const startMs = Date.now();
        const sessionId = input.sessionId ?? (0, uuid_1.v4)();
        const argsJson = JSON.stringify(input.args);
        const storedArgsJson = this.ctx.audit.storeFullArgs ? argsJson : null;
        // ------------------------------------------------------------------
        // 1. Validate upstream
        // ------------------------------------------------------------------
        const upstreamCfg = this.ctx.upstream.getConfig(input.upstreamId);
        if (!upstreamCfg) {
            return { kind: 'deny', requestId, reason: `Unknown upstreamId '${input.upstreamId}'`, httpStatus: 400 };
        }
        // ------------------------------------------------------------------
        // 2. Rate limiting (token bucket per actor:tool)
        // ------------------------------------------------------------------
        const rlKey = `${input.actor.actor}:${input.tool}`;
        const rlResult = this.ctx.rateLimiter.check(rlKey);
        if (!rlResult.allowed) {
            this.ctx.audit.log({
                requestId,
                timestamp: new Date().toISOString(),
                actor: input.actor.actor,
                orgId: input.actor.orgId,
                upstreamId: input.upstreamId,
                tool: input.tool,
                argsHash: this.ctx.audit.hash(input.args),
                argsJson: storedArgsJson,
                decision: 'deny',
                reason: 'rate limit exceeded',
                latencyMs: Date.now() - startMs,
                outcome: 'denied',
                ip: input.ip,
                sessionId,
            });
            return { kind: 'deny', requestId, reason: 'rate limit exceeded', httpStatus: 429, retryAfterMs: rlResult.retryAfterMs };
        }
        // ------------------------------------------------------------------
        // 3. Policy evaluation (OPA or built-in fallback)
        // ------------------------------------------------------------------
        const policyInput = {
            actor: input.actor.actor,
            orgId: input.actor.orgId,
            roles: input.actor.roles,
            upstreamId: input.upstreamId,
            tool: input.tool,
            args: input.args,
            time: new Date().toISOString(),
            ip: input.ip,
            sessionId,
        };
        const decision = await this.ctx.policy.evaluate(policyInput);
        if (!decision.allow) {
            this.ctx.audit.log({
                requestId,
                timestamp: new Date().toISOString(),
                actor: input.actor.actor,
                orgId: input.actor.orgId,
                upstreamId: input.upstreamId,
                tool: input.tool,
                argsHash: this.ctx.audit.hash(input.args),
                argsJson: storedArgsJson,
                decision: 'deny',
                reason: decision.reason,
                latencyMs: Date.now() - startMs,
                outcome: 'denied',
                ip: input.ip,
                sessionId,
            });
            return { kind: 'deny', requestId, reason: decision.reason, httpStatus: 403 };
        }
        // ------------------------------------------------------------------
        // 4. Args size check
        // ------------------------------------------------------------------
        const maxSize = decision.maxArgsSize ?? 102400;
        if (Buffer.byteLength(argsJson) > maxSize) {
            return { kind: 'deny', requestId, reason: `Args payload exceeds max size (${maxSize} bytes)`, httpStatus: 413 };
        }
        // ------------------------------------------------------------------
        // 5. Forward to upstream + 6. Sanitize + 7. Audit
        // ------------------------------------------------------------------
        try {
            const result = await this.ctx.upstream.call(input.upstreamId, {
                tool: input.tool,
                args: input.args,
                sessionId,
                actor: input.actor.actor,
            });
            const sanitized = (0, sanitizer_1.sanitizeResponse)(result.data, decision);
            const responseStr = JSON.stringify(result.data);
            const responseJson = responseStr.length <= 8192 ? responseStr : responseStr.slice(0, 8192) + '…';
            this.ctx.audit.log({
                requestId,
                timestamp: new Date().toISOString(),
                actor: input.actor.actor,
                orgId: input.actor.orgId,
                upstreamId: input.upstreamId,
                tool: input.tool,
                argsHash: this.ctx.audit.hash(input.args),
                argsJson: storedArgsJson,
                decision: 'allow',
                reason: decision.reason,
                latencyMs: Date.now() - startMs,
                outcome: 'success',
                responseHash: this.ctx.audit.hash(result.data),
                responseJson,
                ip: input.ip,
                sessionId,
            });
            return {
                kind: 'allow',
                requestId,
                result: sanitized,
                upstreamId: input.upstreamId,
                latencyMs: result.latencyMs,
                reason: decision.reason,
            };
        }
        catch (err) {
            const upstreamErr = err;
            const errMsg = upstreamErr.message ?? 'Upstream error';
            const latencyMs = upstreamErr.latencyMs ?? 0;
            const statusCode = upstreamErr instanceof upstream_1.UpstreamError ? upstreamErr.statusCode : 502;
            this.ctx.audit.log({
                requestId,
                timestamp: new Date().toISOString(),
                actor: input.actor.actor,
                orgId: input.actor.orgId,
                upstreamId: input.upstreamId,
                tool: input.tool,
                argsHash: this.ctx.audit.hash(input.args),
                argsJson: storedArgsJson,
                decision: 'allow',
                reason: decision.reason,
                latencyMs: Date.now() - startMs,
                outcome: 'error',
                ip: input.ip,
                sessionId,
            });
            return {
                kind: 'error',
                requestId,
                message: errMsg,
                httpStatus: statusCode,
                upstreamId: input.upstreamId,
                latencyMs,
                reason: decision.reason,
            };
        }
    }
}
exports.ToolExecutor = ToolExecutor;
