import { FastifyInstance, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from '../services/audit';
import { TelemetryPayload } from '../types';
import * as ClaudeCodeAdapter from './adapters/claude-code';

interface EventsRouteContext {
  audit: AuditService;
}

function normalizePayload(body: Record<string, unknown>): TelemetryPayload | null {
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
  const payload = body as unknown as TelemetryPayload;
  if (
    typeof payload.source !== 'string' ||
    !payload.source ||
    !Array.isArray(payload.events) ||
    payload.events.length < 1 ||
    payload.events.length > 100
  ) {
    return null;
  }

  for (const event of payload.events) {
    if (typeof event.tool !== 'string' || !event.tool) {
      return null;
    }
  }

  return payload;
}

export function registerEventsRoute(
  app: FastifyInstance,
  ctx: EventsRouteContext
): void {
  app.post(
    '/v1/events',
    async (
      request: FastifyRequest<{ Body: Record<string, unknown> }>,
      reply
    ) => {
      const body = request.body;
      if (!body || typeof body !== 'object') {
        reply.code(400).send({ error: 'Invalid request body' });
        return;
      }

      const payload = normalizePayload(body as Record<string, unknown>);
      if (!payload) {
        reply.code(400).send({
          error:
            'Invalid payload. Expected { source, events: [{ tool, ... }] } or Claude Code hook format { hook_event_name, tool_name, ... }',
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
        const requestId = uuidv4();
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
    }
  );
}
