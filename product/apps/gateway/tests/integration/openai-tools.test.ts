/**
 * Integration tests: OpenAI function-calling endpoint
 * GET  /v1/openai/tools — list tools in OpenAI function schema format
 * POST /v1/openai/tools — execute tool_calls array
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
  const dbPath = path.join(os.tmpdir(), `openai-tools-test-${Date.now()}.db`);
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

// ---------------------------------------------------------------------------
// GET /v1/openai/tools
// ---------------------------------------------------------------------------

describe('GET /v1/openai/tools', () => {
  it('returns 401 without auth', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/v1/openai/tools' });
    expect(res.statusCode).toBe(401);
  });

  it('returns OpenAI function schema list with correct structure', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ object: string; data: unknown[] }>();
    expect(body.object).toBe('list');
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('tool names are namespaced as {upstreamId}__{toolName}', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    const body = res.json<{ data: Array<{ type: string; function: { name: string } }> }>();
    const names = body.data.map((t) => t.function.name);
    expect(names).toContain('fs-server__readFile');
    expect(names).toContain('fs-server__listDir');
    expect(names).toContain('fs-server__writeFile');
  });

  it('each tool has type=function and parameters schema', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${editorToken}` },
    });
    const body = res.json<{ data: Array<{ type: string; function: { name: string; description: string; parameters: unknown } }> }>();
    for (const tool of body.data) {
      expect(tool.type).toBe('function');
      expect(typeof tool.function.name).toBe('string');
      expect(typeof tool.function.description).toBe('string');
      expect(tool.function.parameters).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /v1/openai/tools
// ---------------------------------------------------------------------------

describe('POST /v1/openai/tools', () => {
  it('returns 401 without auth', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/openai/tools',
      payload: { tool_calls: [{ id: 'c1', type: 'function', function: { name: 'fs-server__readFile', arguments: '{"path":"hello.txt"}' } }] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 400 for empty tool_calls', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${editorToken}` },
      payload: { tool_calls: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('executes a valid tool call and returns HTTP 200 with result', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${editorToken}` },
      payload: {
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'fs-server__readFile', arguments: '{"path":"hello.txt"}' } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ tool_call_id: string; role: string; content: string }>>();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0].tool_call_id).toBe('call-1');
    expect(body[0].role).toBe('tool');
    expect(typeof body[0].content).toBe('string');
  });

  it('encodes policy-denied call as error in content (still HTTP 200)', async () => {
    // viewer cannot writeFile — policy denies
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${viewerToken}` },
      payload: {
        tool_calls: [
          { id: 'call-denied', type: 'function', function: { name: 'fs-server__writeFile', arguments: '{"path":"x.txt","content":"pwned"}' } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ tool_call_id: string; content: string }>>();
    expect(body[0].tool_call_id).toBe('call-denied');
    const parsed = JSON.parse(body[0].content) as { error: string };
    expect(typeof parsed.error).toBe('string');
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  it('handles invalid tool name format gracefully (still HTTP 200)', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${editorToken}` },
      payload: {
        tool_calls: [
          { id: 'call-bad', type: 'function', function: { name: 'badname', arguments: '{}' } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ content: string }>>();
    const parsed = JSON.parse(body[0].content) as { error: string };
    expect(parsed.error).toMatch(/Invalid tool name/);
  });

  it('handles malformed JSON arguments gracefully (still HTTP 200)', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${editorToken}` },
      payload: {
        tool_calls: [
          { id: 'call-json-err', type: 'function', function: { name: 'fs-server__readFile', arguments: 'NOT JSON' } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ content: string }>>();
    const parsed = JSON.parse(body[0].content) as { error: string };
    expect(parsed.error).toMatch(/JSON/i);
  });

  it('executes multiple tool_calls sequentially and returns all results', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/openai/tools',
      headers: { Authorization: `Bearer ${editorToken}` },
      payload: {
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'fs-server__readFile', arguments: '{"path":"hello.txt"}' } },
          { id: 'c2', type: 'function', function: { name: 'fs-server__listDir', arguments: '{}' } },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Array<{ tool_call_id: string }>>() ;
    expect(body).toHaveLength(2);
    expect(body[0].tool_call_id).toBe('c1');
    expect(body[1].tool_call_id).toBe('c2');
  });
});
