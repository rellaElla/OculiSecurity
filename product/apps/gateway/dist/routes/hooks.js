"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHooksRoute = registerHooksRoute;
const uuid_1 = require("uuid");
const router_1 = require("./adapters/router");
function registerHooksRoute(app, ctx) {
    app.post('/v1/hooks', async (request, reply) => {
        const body = request.body;
        if (!body || typeof body !== 'object') {
            reply.code(400).send({ error: 'Invalid request body' });
            return;
        }
        // ── Adapter selection ───────────────────────────────────────────────────
        // X-Oculi-Adapter header lets the CLI bypass auto-detection entirely.
        const explicitAdapter = request.headers['x-oculi-adapter'];
        const routed = (0, router_1.route)(body, explicitAdapter);
        if (!routed) {
            reply.code(400).send({
                error: 'Unrecognised hook payload format. Supported: claude-code, cursor, windsurf.',
            });
            return;
        }
        const { adapter, event } = routed;
        // ── From here the pipeline is completely adapter-agnostic ───────────────
        const requestId = (0, uuid_1.v4)();
        const sessionId = event.session_id ?? requestId;
        const ip = request.ip;
        const args = event.tool_args ?? {};
        const argsJson = JSON.stringify(args);
        const storedArgsJson = ctx.audit.storeFullArgs ? argsJson : null;
        const startMs = Date.now();
        const tool = event.tool ?? '__stop__';
        request.log.info({ adapter: routed.adapterName, tool: event.tool, phase: event.phase }, 'hook received');
        // ── Post / complete phase: telemetry only ───────────────────────────────
        if (event.phase === 'post' || event.phase === 'complete') {
            const resultStr = event.tool_result != null ? JSON.stringify(event.tool_result) : null;
            const responseJson = resultStr
                ? resultStr.length <= 8192 ? resultStr : resultStr.slice(0, 8192) + '…'
                : null;
            ctx.audit.log({
                requestId,
                timestamp: event.timestamp ?? new Date().toISOString(),
                actor: event.actor,
                orgId: 'default',
                upstreamId: `ext:${event.ide_source}`,
                tool,
                argsHash: ctx.audit.hash(args),
                argsJson: storedArgsJson,
                decision: 'allow',
                reason: 'telemetry',
                latencyMs: event.duration_ms ?? 0,
                outcome: event.error ? 'error' : 'success',
                responseHash: event.tool_result != null ? ctx.audit.hash(event.tool_result) : undefined,
                responseJson,
                ip,
                sessionId,
            });
            reply.code(202).send({ received: 1 });
            return;
        }
        // ── Pre-phase: rate limit → policy → audit → respond ───────────────────
        // 1. Rate limiting
        const rlKey = `${event.actor}:${tool}`;
        const rlResult = ctx.rateLimiter.check(rlKey);
        if (!rlResult.allowed) {
            ctx.audit.log({
                requestId,
                timestamp: new Date().toISOString(),
                actor: event.actor,
                orgId: 'default',
                upstreamId: `ext:${event.ide_source}`,
                tool,
                argsHash: ctx.audit.hash(args),
                argsJson: storedArgsJson,
                decision: 'deny',
                reason: 'rate limit exceeded',
                latencyMs: Date.now() - startMs,
                outcome: 'denied',
                ip,
                sessionId,
            });
            reply
                .code(adapter.denyStatusCode())
                .send(JSON.parse(adapter.formatDeny('rate limit exceeded')));
            return;
        }
        // 2. Policy evaluation
        const policyInput = {
            actor: event.actor,
            orgId: 'default',
            roles: ['developer'],
            upstreamId: `ext:${event.ide_source}`,
            tool,
            args,
            time: new Date().toISOString(),
            ip,
            sessionId,
        };
        let decision;
        try {
            decision = await ctx.policy.evaluate(policyInput);
        }
        catch (err) {
            // Policy eval failure → fail open so IDEs aren't blocked
            request.log.error({ err }, 'policy eval error in hook — failing open');
            reply.code(200).send(JSON.parse(adapter.formatAllow()));
            return;
        }
        // 3. Audit
        ctx.audit.log({
            requestId,
            timestamp: new Date().toISOString(),
            actor: event.actor,
            orgId: 'default',
            upstreamId: `ext:${event.ide_source}`,
            tool,
            argsHash: ctx.audit.hash(args),
            argsJson: storedArgsJson,
            decision: decision.allow ? 'allow' : 'deny',
            reason: decision.reason,
            latencyMs: Date.now() - startMs,
            outcome: decision.allow ? 'success' : 'denied',
            ip,
            sessionId,
        });
        // 4. Respond in the adapter's native wire format
        if (!decision.allow) {
            reply
                .code(adapter.denyStatusCode())
                .send(JSON.parse(adapter.formatDeny(decision.reason)));
            return;
        }
        reply.code(200).send(JSON.parse(adapter.formatAllow()));
    });
}
//# sourceMappingURL=hooks.js.map