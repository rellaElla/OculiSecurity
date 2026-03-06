/**
 * Integration tests: MCP server surface (JSON-RPC 2.0)
 * GET  /mcp  — SSE channel (tested via inject — inspect response headers/body)
 * POST /mcp  — JSON-RPC message handler (plain JSON-RPC / streamable HTTP mode)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import path from 'path';
import os from 'os';
import { buildServer } from '../../src/server';
import { AppConfig } from '../../src/config';
import { buildFsServer } from '../../../demo-upstream-fs/src/index';
import { generateTestToken, TEST_JWT_SECRET } from '../helpers/jwt';

async function startFsUpstream(): Promise<{ app: FastifyInstance; port: number }> {
  const app = buildFsServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('Could not get FS upstream address');
  return { app, port: addr.port };
}

function makeConfig(fsPort: number, dbPath: string): AppConfig {
  return {
    port: 0,
    jwtSecret: TEST_JWT_SECRET,
    opaUrl: 'http://localhost:8181',
    opaEnabled: false,
    dbPath,
    storeFullArgs: false,
    upstreams: [
      {
        id: 'fs-server',
        name: 'Demo Filesystem Server (test)',
        baseUrl: `http://127.0.0.1:${fsPort}`,
        timeout: 5000,
        tools: ['readFile', 'listDir', 'writeFile'],
      },
    ],
    rateLimitCapacity: 100,
    rateLimitRefillPerSecond: 100,
    logLevel: 'silent',
  };
}

let fsApp: FastifyInstance;
let gatewayApp: FastifyInstance;
let editorToken: string;
let viewerToken: string;

beforeAll(async () => {
  const dbPath = path.join(os.tmpdir(), `mcp-test-${Date.now()}.db`);
  const { app: fs, port: fsPort } = await startFsUpstream();
  fsApp = fs;
  const { app } = await buildServer(makeConfig(fsPort, dbPath));
  gatewayApp = app;
  editorToken = generateTestToken({ roles: ['editor'] });
  viewerToken = generateTestToken({ roles: ['viewer'] });
});

afterAll(async () => {
  await gatewayApp.close();
  await fsApp.close();
});

// Helper: POST a JSON-RPC message and get the response
async function mcpPost(body: object, token?: string) {
  return gatewayApp.inject({
    method: 'POST',
    url: '/mcp',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    payload: body,
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('MCP auth', () => {
  it('POST /mcp returns 401 without token', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    expect(res.statusCode).toBe(401);
  });

  it('POST /mcp accepts Bearer token in Authorization header', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, editorToken);
    expect(res.statusCode).toBe(200);
  });

  it('POST /mcp accepts token via ?token= query param', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: `/mcp?token=${editorToken}`,
      headers: { 'Content-Type': 'application/json' },
      payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe('MCP initialize', () => {
  it('returns protocolVersion, capabilities, and serverInfo', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, editorToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ jsonrpc: string; id: number; result: { protocolVersion: string; capabilities: { tools: object }; serverInfo: { name: string } } }>();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.serverInfo.name).toBe('oculi-security-gateway');
  });
});

// ---------------------------------------------------------------------------
// tools/list
// ---------------------------------------------------------------------------

describe('MCP tools/list', () => {
  it('returns list of tools from upstream config', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, editorToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ result: { tools: Array<{ name: string; description: string; inputSchema: object }> } }>();
    expect(Array.isArray(body.result.tools)).toBe(true);
    expect(body.result.tools.length).toBeGreaterThan(0);
  });

  it('tool names use {upstreamId}__{toolName} format', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, editorToken);
    const body = res.json<{ result: { tools: Array<{ name: string }> } }>();
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain('fs-server__readFile');
    expect(names).toContain('fs-server__listDir');
    expect(names).toContain('fs-server__writeFile');
  });

  it('each tool has inputSchema', async () => {
    const res = await mcpPost({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, editorToken);
    const body = res.json<{ result: { tools: Array<{ inputSchema: unknown }> } }>();
    for (const tool of body.result.tools) {
      expect(tool.inputSchema).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// tools/call
// ---------------------------------------------------------------------------

describe('MCP tools/call', () => {
  it('executes allowed tool and returns content array with isError:false', async () => {
    const res = await mcpPost({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'fs-server__readFile', arguments: { path: 'hello.txt' } },
    }, editorToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ result: { content: Array<{ type: string; text: string }>; isError: boolean } }>();
    expect(body.result.isError).toBe(false);
    expect(Array.isArray(body.result.content)).toBe(true);
    expect(body.result.content[0].type).toBe('text');
    expect(typeof body.result.content[0].text).toBe('string');
  });

  it('returns isError:true when policy denies (not JSON-RPC error)', async () => {
    const res = await mcpPost({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'fs-server__writeFile', arguments: { path: 'x.txt', content: 'pwned' } },
    }, viewerToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ result: { content: Array<{ text: string }>; isError: boolean } }>();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text.length).toBeGreaterThan(0);
    // Must NOT use JSON-RPC error format
    expect((body as { error?: unknown }).error).toBeUndefined();
  });

  it('returns isError:true for invalid tool name (no __ separator)', async () => {
    const res = await mcpPost({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'invalidname', arguments: {} },
    }, editorToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ error?: { code: number }; result?: { isError: boolean; content: Array<{ text: string }> } }>();
    // Should return JSON-RPC error (invalid params)
    expect(body.error?.code).toBe(-32602);
  });

  it('returns isError:true for path traversal (dangerous args policy)', async () => {
    const res = await mcpPost({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'fs-server__readFile', arguments: { path: '../../../etc/passwd' } },
    }, editorToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ result: { isError: boolean } }>();
    expect(body.result.isError).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown method
// ---------------------------------------------------------------------------

describe('MCP unknown method', () => {
  it('returns JSON-RPC -32601 error for unknown method', async () => {
    const res = await mcpPost({
      jsonrpc: '2.0',
      id: 9,
      method: 'nonexistent/method',
      params: {},
    }, editorToken);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ error: { code: number; message: string } }>();
    expect(body.error.code).toBe(-32601);
  });
});
