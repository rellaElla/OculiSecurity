import { FastifyInstance } from 'fastify';
import { CallRequest, GatewayResponse } from '../types';
import { PolicyService } from '../services/policy';
import { AuditService } from '../services/audit';
import { UpstreamConnector } from '../services/upstream';
import { RateLimiter } from '../services/ratelimit';
import { ToolExecutor } from '../services/tool-executor';

interface CallRouteContext {
  policy: PolicyService;
  audit: AuditService;
  upstream: UpstreamConnector;
  rateLimiter: RateLimiter;
}

export function registerCallRoutes(
  app: FastifyInstance,
  ctx: CallRouteContext
): void {
  const executor = new ToolExecutor(ctx);

  app.post<{ Body: CallRequest }>(
    '/v1/call',
    {
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
    },
    async (request, reply) => {
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
          } satisfies GatewayResponse);
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
              } satisfies GatewayResponse);
          } else {
            reply.code(execResult.httpStatus).send({
              requestId: execResult.requestId,
              decision: { allow: false, reason: execResult.reason },
              error: execResult.reason,
            } satisfies GatewayResponse);
          }
          return;

        case 'error':
          reply.code(execResult.httpStatus).send({
            requestId: execResult.requestId,
            decision: { allow: true, reason: execResult.reason },
            upstream: { id: execResult.upstreamId, latencyMs: execResult.latencyMs },
            error: execResult.message,
          } satisfies GatewayResponse);
          return;
      }
    }
  );
}
