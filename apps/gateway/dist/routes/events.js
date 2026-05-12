"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerEventsRoute = registerEventsRoute;
const uuid_1 = require("uuid");
const ClaudeCodeAdapter = __importStar(require("./adapters/claude-code"));
function normalizePayload(body) {
    if (ClaudeCodeAdapter.detect(body)) {
        const event = ClaudeCodeAdapter.normalize(body);
        return {
            source: 'claude-code',
            events: [
                {
                    tool: event.tool ?? '__stop__',
                    args: event.tool_args,
                    result: event.tool_result,
                    sessionId: event.session_id,
                    actor: event.actor,
                },
            ],
        };
    }
    // Standard TelemetryPayload — validate manually
    const payload = body;
    if (typeof payload.source !== 'string' ||
        !payload.source ||
        !Array.isArray(payload.events) ||
        payload.events.length < 1 ||
        payload.events.length > 100) {
        return null;
    }
    for (const event of payload.events) {
        if (typeof event.tool !== 'string' || !event.tool) {
            return null;
        }
    }
    return payload;
}
function registerEventsRoute(app, ctx) {
    app.post('/v1/events', async (request, reply) => {
        const body = request.body;
        if (!body || typeof body !== 'object') {
            reply.code(400).send({ error: 'Invalid request body' });
            return;
        }
        const payload = normalizePayload(body);
        if (!payload) {
            reply.code(400).send({
                error: 'Invalid payload. Expected { source, events: [{ tool, ... }] } or Claude Code hook format { hook_event_name, tool_name, ... }',
            });
            return;
        }
        const { source, orgId, events } = payload;
        const ip = request.ip;
        const isClaudeCode = source === 'claude-code';
        // For Claude Code hooks, stash the full raw body so nothing is lost
        const rawBodyJson = isClaudeCode ? JSON.stringify(body) : null;
        request.log.info({ source, toolCount: events.length }, 'telemetry received');
        if (isClaudeCode) {
            request.log.debug({ rawBody: body }, 'claude-code hook raw payload');
        }
        for (const event of events) {
            const requestId = (0, uuid_1.v4)();
            // For Claude Code hooks use raw body; for standard events use parsed args
            const argsJson = isClaudeCode
                ? rawBodyJson
                : (event.args ? JSON.stringify(event.args) : null);
            const resultStr = event.result != null ? JSON.stringify(event.result) : null;
            const responseJson = resultStr
                ? resultStr.length <= 8192 ? resultStr : resultStr.slice(0, 8192) + '…'
                : null;
            ctx.audit.log({
                requestId,
                timestamp: event.timestamp ?? new Date().toISOString(),
                actor: event.actor ?? source,
                orgId: orgId ?? 'default',
                upstreamId: `ext:${source}`,
                tool: event.tool,
                argsHash: event.args ? ctx.audit.hash(event.args) : 'none',
                argsJson,
                decision: 'allow',
                reason: 'telemetry',
                latencyMs: event.durationMs ?? 0,
                outcome: event.error ? 'error' : 'success',
                responseHash: event.result != null ? ctx.audit.hash(event.result) : undefined,
                responseJson,
                ip,
                sessionId: event.sessionId ?? requestId,
            });
        }
        reply.code(202).send({ received: events.length });
    });
}
