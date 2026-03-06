import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { UpstreamConnector } from '../services/upstream';
import { ToolExecutor } from '../services/tool-executor';
import { resolveActor } from '../middleware/auth';

const MCP_PROTOCOL_VERSION = '2024-11-05';
const GATEWAY_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// MCP JSON-RPC types
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: { type: 'object'; additionalProperties: true };
}

// ---------------------------------------------------------------------------
// In-process SSE session store
// TODO: multi-replica — replace with Redis pub/sub so sessions survive restarts
// and work across gateway replicas.
// ---------------------------------------------------------------------------

const sseSessions = new Map<string, FastifyReply>();

// ---------------------------------------------------------------------------
// Context & helpers
// ---------------------------------------------------------------------------

interface McpRouteContext {
  executor: ToolExecutor;
  upstream: UpstreamConnector;
  jwtSecret: string;
}

/** Split "{upstreamId}__{toolName}" — returns null if format is invalid. */
function parseToolName(namespaced: string): { upstreamId: string; tool: string } | null {
  const idx = namespaced.indexOf('__');
  if (idx === -1) return null;
  return { upstreamId: namespaced.slice(0, idx), tool: namespaced.slice(idx + 2) };
}

function buildToolList(upstream: UpstreamConnector): McpTool[] {
  return upstream.listUpstreams().flatMap((u) =>
    (u.tools ?? []).map((toolName) => ({
      name: `${u.id}__${toolName}`,
      description: `${toolName} on ${u.name}`,
      inputSchema: { type: 'object' as const, additionalProperties: true as const },
    }))
  );
}

function jsonRpcError(
  id: number | string | null,
  code: number,
  message: string
): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerMcpRoutes(app: FastifyInstance, ctx: McpRouteContext): void {

  // -------------------------------------------------------------------------
  // GET /mcp — establish SSE push channel (used by Claude Desktop / Code and
  // any other MCP client that prefers the legacy SSE transport).
  // -------------------------------------------------------------------------
  app.get('/mcp', async (request: FastifyRequest, reply: FastifyReply) => {
    const actor = resolveActor(request, ctx.jwtSecret);
    if (!actor) {
      reply.code(401).send({ error: 'Unauthorized. Provide Authorization: Bearer <token> header or ?token= query parameter.' });
      return;
    }

    const sessionId = uuidv4();

    // Take over the raw HTTP response — Fastify must not touch it after this
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    reply.raw.flushHeaders();

    sseSessions.set(sessionId, reply);

    // Tell the client which URL to POST messages to
    const endpointUrl = `/mcp?session=${sessionId}`;
    reply.raw.write(`data: ${JSON.stringify({ type: 'endpoint', uri: endpointUrl })}\n\n`);

    // Heartbeat every 30 s to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(': ping\n\n');
      }
    }, 30_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      sseSessions.delete(sessionId);
    });

    // Fastify's reply lifecycle is now bypassed — prevent it from finalising
    await new Promise<void>((resolve) => request.raw.on('close', resolve));
  });

  // -------------------------------------------------------------------------
  // POST /mcp — JSON-RPC 2.0 message handler (MCP 2024-11-05 streamable HTTP
  // transport). Supports both:
  //   - Streamable HTTP: respond directly in the HTTP body (no ?session=)
  //   - SSE transport: forward response over the SSE channel (?session=<id>)
  // -------------------------------------------------------------------------
  app.post<{ Body: JsonRpcRequest; Querystring: { session?: string; token?: string } }>(
    '/mcp',
    async (request, reply) => {
      const actor = resolveActor(request, ctx.jwtSecret);
      if (!actor) {
        reply.code(401).send({ error: 'Unauthorized' });
        return;
      }

      const msg = request.body;
      const sessionId = (request.query as Record<string, string | undefined>).session;
      const sseReply = sessionId ? sseSessions.get(sessionId) : undefined;

      /** Send a JSON-RPC response — either over SSE or directly as HTTP body. */
      const respond = (payload: JsonRpcResponse): void => {
        if (sseReply && !sseReply.raw.writableEnded) {
          sseReply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
          reply.code(202).send();
        } else {
          reply.code(200).send(payload);
        }
      };

      // MCP protocol: stateless — clients may call tools/call without initialize.
      // Note: initialize is optional for clients that skip handshake.
      switch (msg.method) {
        // -------------------------------------------------------------------
        case 'initialize':
          respond({
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: MCP_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: { name: 'oculi-security-gateway', version: GATEWAY_VERSION },
            },
          });
          return;

        // -------------------------------------------------------------------
        case 'tools/list':
          respond({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: buildToolList(ctx.upstream) },
          });
          return;

        // -------------------------------------------------------------------
        case 'tools/call': {
          const params = msg.params as { name: string; arguments?: Record<string, unknown> } | undefined;
          if (!params?.name) {
            respond(jsonRpcError(msg.id, -32602, 'params.name is required'));
            return;
          }

          const parsed = parseToolName(params.name);
          if (!parsed) {
            respond(jsonRpcError(msg.id, -32602,
              `Invalid tool name '${params.name}'. Expected format: '{upstreamId}__{toolName}'`
            ));
            return;
          }

          const execResult = await ctx.executor.execute({
            actor,
            upstreamId: parsed.upstreamId,
            tool: parsed.tool,
            args: params.arguments ?? {},
            ip: request.ip,
          });

          // MCP spec: tool errors use isError:true in result, not JSON-RPC error
          switch (execResult.kind) {
            case 'allow':
              respond({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  content: [{ type: 'text', text: JSON.stringify(execResult.result) }],
                  isError: false,
                },
              });
              break;
            case 'deny':
            case 'error':
              respond({
                jsonrpc: '2.0',
                id: msg.id,
                result: {
                  content: [{
                    type: 'text',
                    text: execResult.kind === 'deny' ? execResult.reason : execResult.message,
                  }],
                  isError: true,
                },
              });
              break;
          }
          return;
        }

        // -------------------------------------------------------------------
        default:
          respond(jsonRpcError(msg.id, -32601, `Method not found: ${String(msg.method)}`));
      }
    }
  );
}
