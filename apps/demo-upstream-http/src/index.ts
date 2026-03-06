/**
 * Demo Upstream: HTTP Fetch MCP Server
 *
 * Accepts: POST /v1/call { tool, args, sessionId, actor }
 * Tools:   fetchUrl, postUrl
 *
 * WARNING: fetchUrl/postUrl make outbound HTTP requests.
 * Production deployments should add egress filtering to block
 * private IP ranges (RFC 1918) and cloud metadata endpoints.
 */

import axios from 'axios';
import Fastify, { FastifyInstance } from 'fastify';

const PORT = parseInt(process.env.HTTP_PORT ?? '3002', 10);
const FETCH_TIMEOUT = parseInt(process.env.HTTP_FETCH_TIMEOUT ?? '10000', 10);

// Basic SSRF protection: block private/metadata IP ranges
const BLOCKED_PATTERNS = [
  /^https?:\/\/localhost/i,
  /^https?:\/\/127\./,
  /^https?:\/\/10\./,
  /^https?:\/\/172\.(1[6-9]|2[0-9]|3[01])\./,
  /^https?:\/\/192\.168\./,
  /^https?:\/\/169\.254\./,  // link-local / AWS metadata
  /^https?:\/\/::1/,
  /^https?:\/\/\[::1\]/,
];

function validateUrl(url: string): void {
  if (!url || typeof url !== 'string') {
    throw new Error('fetchUrl requires args.url (string)');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: '${url}'`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`URL must use http or https, got: '${parsed.protocol}'`);
  }

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(url)) {
      throw new Error(`URL '${url}' is blocked (private/metadata range)`);
    }
  }
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

interface ToolArgs { [key: string]: unknown }

async function handleFetchUrl(args: ToolArgs): Promise<unknown> {
  const url = args.url as string;
  validateUrl(url);

  const response = await axios.get<string>(url, {
    timeout: FETCH_TIMEOUT,
    maxContentLength: 1_000_000, // 1 MB max response
    responseType: 'text',
    validateStatus: () => true,
  });

  return {
    url,
    status: response.status,
    contentType: response.headers['content-type'] ?? 'unknown',
    bodyLength: (response.data as string).length,
    body: (response.data as string).slice(0, 2000), // truncate at upstream for safety
  };
}

async function handlePostUrl(args: ToolArgs): Promise<unknown> {
  const url = args.url as string;
  const body = args.body;
  validateUrl(url);

  const response = await axios.post<string>(url, body, {
    timeout: FETCH_TIMEOUT,
    maxContentLength: 1_000_000,
    responseType: 'text',
    validateStatus: () => true,
  });

  return {
    url,
    status: response.status,
    contentType: response.headers['content-type'] ?? 'unknown',
    body: (response.data as string).slice(0, 2000),
  };
}

// ---------------------------------------------------------------------------
// Server factory (exported for tests)
// ---------------------------------------------------------------------------

export function buildHttpServer(): FastifyInstance {
  const app = Fastify({
    logger: process.env.LOG_LEVEL
      ? { level: process.env.LOG_LEVEL }
      : false,
  });

  app.post<{ Body: { tool: string; args: ToolArgs; sessionId?: string; actor?: string } }>(
    '/v1/call',
    async (request, reply) => {
      const { tool, args = {} } = request.body;

      try {
        let result: unknown;

        switch (tool) {
          case 'fetchUrl':
            result = await handleFetchUrl(args);
            break;
          case 'postUrl':
            result = await handlePostUrl(args);
            break;
          default:
            reply.code(400).send({ error: `Unknown tool: '${tool}'` });
            return;
        }

        reply.send({ tool, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400).send({ error: message });
      }
    }
  );

  app.get('/health', async (_req, reply) => {
    reply.send({ status: 'ok', service: 'demo-upstream-http' });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const server = buildHttpServer();

  server.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`[demo-http] HTTP upstream listening on :${PORT}`);
    console.log(`[demo-http] Tools: fetchUrl, postUrl`);
  });
}
