import { FastifyInstance } from 'fastify';
import { UpstreamConnector } from '../services/upstream';
import { ToolExecutor } from '../services/tool-executor';

interface OpenAIToolsRouteContext {
  executor: ToolExecutor;
  upstream: UpstreamConnector;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;      // "{upstreamId}__{toolName}"
    arguments: string; // JSON-encoded string (OpenAI sends it serialised)
  };
}

interface OpenAIToolCallsRequest {
  tool_calls: OpenAIToolCall[];
  session_id?: string;
}

interface OpenAIToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

/** Split "{upstreamId}__{toolName}" into parts. Returns null if format invalid. */
function parseToolName(namespaced: string): { upstreamId: string; tool: string } | null {
  const idx = namespaced.indexOf('__');
  if (idx === -1) return null;
  return { upstreamId: namespaced.slice(0, idx), tool: namespaced.slice(idx + 2) };
}

export function registerOpenAIToolsRoutes(
  app: FastifyInstance,
  ctx: OpenAIToolsRouteContext
): void {
  // -----------------------------------------------------------------------
  // GET /v1/openai/tools — list all tools in OpenAI function schema format
  // -----------------------------------------------------------------------
  app.get('/v1/openai/tools', async (request, reply) => {
    if (!request.actor?.actor) {
      reply.code(401).send({ error: 'Unauthorized' });
      return;
    }

    const data = ctx.upstream.listUpstreams().flatMap((u) =>
      (u.tools ?? []).map((toolName) => ({
        type: 'function' as const,
        function: {
          name: `${u.id}__${toolName}`,
          description: `${toolName} on ${u.name}`,
          parameters: {
            type: 'object',
            properties: {},
            additionalProperties: true,
          },
        },
      }))
    );

    reply.send({ object: 'list', data });
  });

  // -----------------------------------------------------------------------
  // POST /v1/openai/tools — execute an array of OpenAI tool_calls
  // -----------------------------------------------------------------------
  app.post<{ Body: OpenAIToolCallsRequest }>(
    '/v1/openai/tools',
    {
      schema: {
        body: {
          type: 'object',
          required: ['tool_calls'],
          properties: {
            tool_calls: { type: 'array' },
            session_id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      if (!request.actor?.actor) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      const { tool_calls, session_id } = request.body;

      if (!Array.isArray(tool_calls) || tool_calls.length === 0) {
        reply.code(400).send({ error: 'tool_calls must be a non-empty array' });
        return;
      }

      const results: OpenAIToolResult[] = [];

      // Execute sequentially — avoids burst tripping rate limiter and matches
      // how OpenAI clients consume tool results (ordered array).
      for (const call of tool_calls) {
        if (call.type !== 'function') {
          results.push({
            tool_call_id: call.id,
            role: 'tool',
            content: JSON.stringify({ error: `Unsupported tool call type: ${String(call.type)}` }),
          });
          continue;
        }

        const parsed = parseToolName(call.function.name);
        if (!parsed) {
          results.push({
            tool_call_id: call.id,
            role: 'tool',
            content: JSON.stringify({
              error: `Invalid tool name '${call.function.name}'. Expected format: '{upstreamId}__{toolName}'`,
            }),
          });
          continue;
        }

        let args: Record<string, unknown>;
        try {
          args = JSON.parse(call.function.arguments) as Record<string, unknown>;
        } catch {
          results.push({
            tool_call_id: call.id,
            role: 'tool',
            content: JSON.stringify({ error: 'Failed to parse tool arguments as JSON' }),
          });
          continue;
        }

        const execResult = await ctx.executor.execute({
          actor: request.actor,
          upstreamId: parsed.upstreamId,
          tool: parsed.tool,
          args,
          sessionId: session_id,
          ip: request.ip,
        });

        let content: string;
        switch (execResult.kind) {
          case 'allow':
            content =
              typeof execResult.result === 'string'
                ? execResult.result
                : JSON.stringify(execResult.result);
            break;
          case 'deny':
            content = JSON.stringify({ error: execResult.reason });
            break;
          case 'error':
            content = JSON.stringify({ error: execResult.message });
            break;
        }

        results.push({ tool_call_id: call.id, role: 'tool', content });
      }

      // Always HTTP 200 — per-tool errors are encoded in content, per OpenAI conventions
      reply.code(200).send(results);
    }
  );
}
