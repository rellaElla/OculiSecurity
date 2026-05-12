"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerCallRoutes = registerCallRoutes;
const tool_executor_1 = require("../services/tool-executor");
function registerCallRoutes(app, ctx) {
    const executor = new tool_executor_1.ToolExecutor(ctx);
    app.post('/v1/call', {
        schema: {
            body: {
                type: 'object',
                required: ['upstreamId', 'tool', 'args'],
                properties: {
                    upstreamId: { type: 'string' },
                    tool: { type: 'string' },
                    args: { type: 'object' },
                    sessionId: { type: 'string' },
                },
            },
        },
    }, async (request, reply) => {
        const { upstreamId, tool, args, sessionId } = request.body;
        const execResult = await executor.execute({
            actor: request.actor,
            upstreamId,
            tool,
            args,
            sessionId,
            ip: request.ip,
        });
        switch (execResult.kind) {
            case 'allow':
                reply.code(200).send({
                    requestId: execResult.requestId,
                    decision: { allow: true, reason: execResult.reason },
                    upstream: { id: execResult.upstreamId, latencyMs: execResult.latencyMs },
                    result: execResult.result,
                });
                return;
            case 'deny':
                if (execResult.httpStatus === 429) {
                    reply
                        .code(429)
                        .header('Retry-After', String(Math.ceil((execResult.retryAfterMs ?? 0) / 1000)))
                        .send({
                        requestId: execResult.requestId,
                        decision: { allow: false, reason: execResult.reason },
                        error: `Rate limit exceeded. Retry after ~${execResult.retryAfterMs}ms`,
                    });
                }
                else {
                    reply.code(execResult.httpStatus).send({
                        requestId: execResult.requestId,
                        decision: { allow: false, reason: execResult.reason },
                        error: execResult.reason,
                    });
                }
                return;
            case 'error':
                reply.code(execResult.httpStatus).send({
                    requestId: execResult.requestId,
                    decision: { allow: true, reason: execResult.reason },
                    upstream: { id: execResult.upstreamId, latencyMs: execResult.latencyMs },
                    error: execResult.message,
                });
                return;
        }
    });
}
