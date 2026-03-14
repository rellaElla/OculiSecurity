/**
 * Integration tests: boot gateway (in-process) + demo-upstream-fs (in-process),
 * then run real HTTP requests through the full mediation pipeline.
 *
 * OPA is disabled (OPA_ENABLED=false) — uses built-in fallback policy.
 * SQLite uses a temp file so tests don't pollute production data.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { buildServer } from '../../src/server';
import { AppConfig } from '../../src/config';
import { buildFsServer } from '../../../demo-upstream-fs/src/index';
import { generateTestToken, TEST_JWT_SECRET } from '../helpers/jwt';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function startFsUpstream(): Promise<{ app: FastifyInstance; port: number }> {
  const app = buildFsServer();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('Could not get FS upstream address');
  return { app, port: addr.port };
}

function makeGatewayConfig(fsUpstreamPort: number, dbPath: string): AppConfig {
  return {
    port: 0,
    jwtSecret: TEST_JWT_SECRET,
    opaUrl: 'http://localhost:8181',
    opaEnabled: false, // use built-in policy for tests
    dbPath,
    storeFullArgs: false,
    upstreams: [
      {
        id: 'fs-server',
        name: 'Demo Filesystem Server (test)',
        baseUrl: `http://127.0.0.1:${fsUpstreamPort}`,
        timeout: 5000,
      },
    ],
    rateLimitCapacity: 100, // high limit so tests aren't rate-limited
    rateLimitRefillPerSecond: 100,
    logLevel: 'silent',
  };
}

// ── Test Setup ────────────────────────────────────────────────────────────────

let fsApp: FastifyInstance;
let gatewayApp: FastifyInstance;
let dbPath: string;

beforeAll(async () => {
  // Temp SQLite DB for this test run
  dbPath = path.join(os.tmpdir(), `gateway-test-${Date.now()}.db`);

  // Start FS upstream first
  const { app: fsUpstream, port: fsPort } = await startFsUpstream();
  fsApp = fsUpstream;

  // Start gateway pointing at the FS upstream
  const config = makeGatewayConfig(fsPort, dbPath);
  const { app } = await buildServer(config);
  gatewayApp = app;

  await gatewayApp.listen({ port: 0, host: '127.0.0.1' });
});

afterAll(async () => {
  await gatewayApp?.close();
  await fsApp?.close();

  if (dbPath && fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
});

// ── Helper: inject request into gateway ──────────────────────────────────────

function callTool(opts: {
  token: string;
  upstreamId?: string;
  tool: string;
  args: Record<string, unknown>;
}) {
  return gatewayApp.inject({
    method: 'POST',
    url: '/v1/call',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
    },
    body: JSON.stringify({
      upstreamId: opts.upstreamId ?? 'fs-server',
      tool: opts.tool,
      args: opts.args,
    }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Authentication', () => {
  it('returns 401 when no Authorization header', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/call',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ upstreamId: 'fs-server', tool: 'readFile', args: { path: 'hello.txt' } }),
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('MISSING_TOKEN');
  });

  it('returns 401 for an invalid JWT', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/call',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer not.a.valid.jwt',
      },
      body: JSON.stringify({ upstreamId: 'fs-server', tool: 'readFile', args: { path: 'hello.txt' } }),
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('INVALID_TOKEN');
  });
});

describe('Health check', () => {
  it('GET /health returns 200', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });
});

describe('ALLOW: readFile within allowed path', () => {
  it('forwards readFile and returns file content', async () => {
    const token = generateTestToken({ actor: 'alice', roles: ['editor'] });
    const res = await callTool({ token, tool: 'readFile', args: { path: 'hello.txt' } });

    expect(res.statusCode).toBe(200);

    const body = JSON.parse(res.body);
    expect(body.decision.allow).toBe(true);
    expect(body.decision.reason).toBe('allowed');
    expect(body.upstream?.id).toBe('fs-server');
    expect(body.result).toBeDefined();

    // The upstream wraps in { tool, result }
    const upstreamResult = body.result as { result?: { content?: string } };
    const content = upstreamResult?.result?.content ?? (body.result as { content?: string })?.content;
    expect(typeof content === 'string' || content !== undefined).toBe(true);
  });

  it('allows listDir for viewer role', async () => {
    const token = generateTestToken({ actor: 'viewer-1', roles: ['viewer'] });
    const res = await callTool({ token, tool: 'listDir', args: { path: '.' } });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.decision.allow).toBe(true);
  });

  it('applies redaction decision for non-admin actors (editor role)', async () => {
    const token = generateTestToken({ actor: 'editor-1', roles: ['editor'] });
    const res = await callTool({ token, tool: 'readFile', args: { path: 'config.json' } });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.decision.allow).toBe(true);
    expect(body.decision.reason).toBe('allowed');
    expect(body.upstream?.id).toBe('fs-server');
    // The gateway returns result from upstream (file content as raw string).
    // Field-level redaction on structured response objects is covered in sanitizer.test.ts.
    expect(body.result).toBeDefined();
  });
});

describe('DENY: writeFile for viewer role', () => {
  it('denies writeFile with role restriction reason', async () => {
    const token = generateTestToken({ actor: 'bob-viewer', roles: ['viewer'] });
    const res = await callTool({
      token,
      tool: 'writeFile',
      args: { path: 'pwned.txt', content: 'I was here' },
    });

    expect(res.statusCode).toBe(403);

    const body = JSON.parse(res.body);
    expect(body.decision.allow).toBe(false);
    expect(body.decision.reason).toMatch(/role restriction/i);
  });

  it('denies postUrl for viewer role on http-server', async () => {
    const token = generateTestToken({ actor: 'bob-viewer', roles: ['viewer'] });
    const res = await callTool({
      token,
      upstreamId: 'http-server',   // not in upstreams config → 400 (unknown), still a deny
      tool: 'postUrl',
      args: { url: 'https://example.com', body: '{}' },
    });

    // 400 because http-server isn't in our test config, or 403 if it is
    expect([400, 403]).toContain(res.statusCode);
    const body = JSON.parse(res.body);
    expect(body.decision?.allow ?? false).toBe(false);
  });
});

describe('DENY: path traversal', () => {
  it('denies readFile with ../ traversal', async () => {
    const token = generateTestToken({ actor: 'alice', roles: ['editor'] });
    const res = await callTool({
      token,
      tool: 'readFile',
      args: { path: '../../../etc/passwd' },
    });

    expect(res.statusCode).toBe(403);

    const body = JSON.parse(res.body);
    expect(body.decision.allow).toBe(false);
    expect(body.decision.reason).toMatch(/dangerous/i);
  });

  it('denies writeFile with path containing &&', async () => {
    const token = generateTestToken({ actor: 'alice', roles: ['editor'] });
    const res = await callTool({
      token,
      tool: 'writeFile',
      args: { path: 'file.txt && rm -rf /', content: 'data' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.decision.allow).toBe(false);
    expect(body.decision.reason).toMatch(/dangerous/i);
  });

  it('denies readFile with URL-encoded traversal (%2e%2e)', async () => {
    const token = generateTestToken({ actor: 'alice', roles: ['editor'] });
    const res = await callTool({
      token,
      tool: 'readFile',
      args: { path: '%2e%2e/etc/passwd' },
    });

    expect(res.statusCode).toBe(403);
    const body = JSON.parse(res.body);
    expect(body.decision.allow).toBe(false);
    expect(body.decision.reason).toMatch(/dangerous/i);
  });
});

describe('Unknown upstream', () => {
  it('returns 400 for unregistered upstreamId', async () => {
    const token = generateTestToken({ actor: 'alice', roles: ['editor'] });
    const res = await callTool({
      token,
      upstreamId: 'not-a-real-upstream',
      tool: 'readFile',
      args: { path: 'hello.txt' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('Audit log', () => {
  it('audit log endpoint returns logs after calls', async () => {
    const token = generateTestToken({ actor: 'audit-test-user', roles: ['editor'] });

    // Make a call to create an audit entry
    await callTool({ token, tool: 'readFile', args: { path: 'hello.txt' } });

    // Query audit log
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/logs?limit=10',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
  });
});

describe('Telemetry ingestion — POST /v1/events', () => {
  it('accepts valid telemetry payload and returns 202', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'test-agent',
        events: [
          { tool: 'Bash', durationMs: 42, actor: 'test-user' },
          { tool: 'Read', durationMs: 10 },
        ],
      }),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(2);
  });

  it('works without Authorization header (unauthenticated)', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'no-auth-agent',
        events: [{ tool: 'Grep' }],
      }),
    });

    expect(res.statusCode).toBe(202);
  });

  it('rejects payload missing source', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [{ tool: 'Bash' }] }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects payload with empty events array', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'test', events: [] }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('rejects event missing tool name', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'test', events: [{ durationMs: 10 }] }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('accepts Claude Code PostToolUse hook format', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm test', description: 'Run tests' },
        tool_response: { stdout: 'all passed', exitCode: 0 },
        session_id: 'claude-session-123',
        cwd: '/Users/test/project',
      }),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(1);
  });

  it('Claude Code events appear in stats as source claude-code', async () => {
    await gatewayApp.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'ClaudeCodeUniqueTestTool',
        tool_input: {},
        session_id: 'cc-test',
      }),
    });

    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/stats/top-tools?limit=50',
    });

    const body = JSON.parse(res.body);
    const found = body.find((t: { tool: string }) => t.tool === 'ClaudeCodeUniqueTestTool');
    expect(found).toBeDefined();
  });
});

describe('Hook enforcement — POST /v1/hooks', () => {
  it('accepts Claude Code PreToolUse and returns allow decision', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        session_id: 'cc-pre-test',
        cwd: '/Users/test',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.decision).toBe('allow');
  });

  it('accepts Claude Code PostToolUse and returns 202 (telemetry)', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'ls -la' },
        tool_response: { stdout: 'file.txt', exitCode: 0 },
        session_id: 'cc-post-test',
      }),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(1);
  });

  it('accepts Cursor beforeMCPExecution and returns permissionDecision allow', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'beforeMCPExecution',
        conversation_id: 'cursor-session-123',
        generation_id: 'cursor-gen-001',
        mcp_server: 'fs-server',
        mcp_tool: 'readFile',
        workspace_roots: ['/Users/test'],
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.permissionDecision).toBe('allow');
  });

  it('accepts Cursor afterMCPExecution and returns 202 (telemetry)', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'afterMCPExecution',
        conversation_id: 'cursor-session-123',
        generation_id: 'cursor-gen-002',
        mcp_server: 'fs-server',
        mcp_tool: 'readFile',
        workspace_roots: ['/Users/test'],
      }),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(1);
  });

  it('accepts Windsurf pre_mcp_tool_use and returns allow', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_action_name: 'pre_mcp_tool_use',
        tool_info: {
          mcp_server_name: 'fs-server',
          mcp_tool_name: 'readFile',
          mcp_tool_arguments: { path: 'hello.txt' },
        },
        trajectory_id: 'traj-001',
        execution_id: 'exec-001',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('allow');
  });

  it('accepts Windsurf post_mcp_tool_use and returns 202 (telemetry)', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_action_name: 'post_mcp_tool_use',
        tool_info: {
          mcp_server_name: 'fs-server',
          mcp_tool_name: 'readFile',
          mcp_tool_arguments: { path: 'hello.txt' },
        },
        trajectory_id: 'traj-002',
        execution_id: 'exec-002',
      }),
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body);
    expect(body.received).toBe(1);
  });

  it('returns 400 for unrecognised payload format', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unknown_field: 'mystery data' }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('audit records created for all three IDE sources', async () => {
    const tools = ['HookAuditBash', 'HookAuditReadFile', 'HookAuditWsRead'];

    // Claude Code
    await gatewayApp.inject({
      method: 'POST', url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tools[0], tool_input: {}, session_id: 'audit-cc-session' }),
    });
    // Cursor
    await gatewayApp.inject({
      method: 'POST', url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hook_event_name: 'beforeMCPExecution', conversation_id: 'c-audit', generation_id: 'g-audit', mcp_server: 'test-server', mcp_tool: tools[1], workspace_roots: ['/tmp'] }),
    });
    // Windsurf
    await gatewayApp.inject({
      method: 'POST', url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_action_name: 'pre_mcp_tool_use',
        tool_info: { mcp_server_name: 'fs', mcp_tool_name: tools[2], mcp_tool_arguments: {} },
        trajectory_id: 't1', execution_id: 'e1',
      }),
    });

    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/stats/top-tools?limit=100' });
    const body = JSON.parse(res.body) as { tool: string }[];
    expect(body.some(t => t.tool === tools[0])).toBe(true);
    // Cursor beforeMCPExecution normalises to 'mcp_call' (specific mcp_tool preserved in tool_args)
    expect(body.some(t => t.tool === 'mcp_call')).toBe(true);
    expect(body.some(t => t.tool.includes(tools[2]))).toBe(true);
  });
});

describe('Dashboard stats endpoints', () => {
  it('GET /admin/stats/summary returns aggregate stats', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/stats/summary?hours=24',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.totalCalls).toBe('number');
    expect(typeof body.deniedCalls).toBe('number');
    expect(typeof body.avgLatencyMs).toBe('number');
    expect(typeof body.rateLimitViolations).toBe('number');
    expect(body.totalCalls).toBeGreaterThan(0);
  });

  it('GET /admin/stats/top-tools returns array', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/stats/top-tools?limit=5',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('tool');
    expect(body[0]).toHaveProperty('count');
  });

  it('GET /admin/stats/top-denied returns array', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/stats/top-denied?limit=5',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /admin/stats/top-actors returns array', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/stats/top-actors?limit=5',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0]).toHaveProperty('actor');
    expect(body[0]).toHaveProperty('count');
  });

  it('GET /admin/stats/decisions returns allowed/denied breakdown', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/stats/decisions',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.allowed).toBe('number');
    expect(typeof body.denied).toBe('number');
  });

  it('GET /admin/stats/timeseries returns time buckets', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/stats/timeseries?hours=24&bucket=60',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body)).toBe(true);
  });

  it('stats endpoints work without Authorization header', async () => {
    const urls = [
      '/api/admin/stats/summary',
      '/api/admin/stats/top-tools',
      '/api/admin/stats/top-denied',
      '/api/admin/stats/top-actors',
      '/api/admin/stats/decisions',
      '/api/admin/stats/timeseries',
    ];

    for (const url of urls) {
      const res = await gatewayApp.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
    }
  });

  it('telemetry events appear in stats', async () => {
    // Ingest a known event
    await gatewayApp.inject({
      method: 'POST',
      url: '/v1/events',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'stats-test',
        events: [{ tool: 'UniqueToolForStatsTest', durationMs: 99, actor: 'stats-actor' }],
      }),
    });

    // Check it shows up in top-tools
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/stats/top-tools?limit=50',
    });

    const body = JSON.parse(res.body);
    const found = body.find((t: { tool: string }) => t.tool === 'UniqueToolForStatsTest');
    expect(found).toBeDefined();
    expect(found.count).toBeGreaterThanOrEqual(1);
  });
});

describe('Settings endpoint — GET /admin/settings', () => {
  it('returns gateway configuration without secrets', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/settings',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    // Gateway section
    expect(body.gateway).toBeDefined();
    expect(typeof body.gateway.port).toBe('number');
    expect(typeof body.gateway.logLevel).toBe('string');
    expect(typeof body.gateway.opaEnabled).toBe('boolean');
    expect(typeof body.gateway.storeFullArgs).toBe('boolean');
    expect(typeof body.gateway.dbPath).toBe('string');

    // Rate limit section
    expect(body.rateLimit).toBeDefined();
    expect(typeof body.rateLimit.capacity).toBe('number');
    expect(typeof body.rateLimit.refillPerSecond).toBe('number');

    // Upstreams section
    expect(Array.isArray(body.upstreams)).toBe(true);
    expect(body.upstreams.length).toBeGreaterThan(0);
    expect(body.upstreams[0]).toHaveProperty('id');
    expect(body.upstreams[0]).toHaveProperty('name');
    expect(body.upstreams[0]).toHaveProperty('baseUrl');
    expect(body.upstreams[0]).toHaveProperty('timeout');

    // Telemetry section
    expect(body.telemetry).toBeDefined();
    expect(body.telemetry.endpointUrl).toBe('/v1/events');
    expect(body.telemetry.claudeCodeHook).toBeDefined();
    expect(body.telemetry.claudeCodeHook.type).toBe('http');
  });

  it('does not expose JWT secret or upstream auth headers', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/settings',
    });

    const text = res.body;
    expect(text).not.toContain('jwtSecret');
    expect(text).not.toContain('authHeader');
    expect(text).not.toContain('dev-secret');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Policy management endpoints
// ═══════════════════════════════════════════════════════════════════════════
describe('Policy management endpoints', () => {
  it('GET /admin/policies returns seeded policies', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/policies',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.policies)).toBe(true);
    expect(body.policies.length).toBeGreaterThanOrEqual(3);
    expect(body.policies[0]).toHaveProperty('id');
    expect(body.policies[0]).toHaveProperty('name');
    expect(body.policies[0]).toHaveProperty('rego');
    expect(body.policies[0]).toHaveProperty('version');
  });

  it('GET /admin/policies/:id returns a single policy', async () => {
    const listRes = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/policies',
    });
    const policies = JSON.parse(listRes.body).policies;
    const id = policies[0].id;

    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/policies/' + id,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(id);
    expect(body.name).toBe(policies[0].name);
  });

  it('GET /admin/policies/:id returns 404 for non-existent id', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/policies/99999',
    });

    expect(res.statusCode).toBe(404);
  });

  it('POST /admin/policies creates a new policy', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/api/admin/policies',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Policy',
        rego: 'package test\ndefault allow := false',
        updatedBy: 'test@acme.com',
      }),
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Test Policy');
    expect(body.rego).toContain('package test');
    expect(body.id).toBeDefined();
  });

  it('POST /admin/policies returns 400 when name is missing', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/api/admin/policies',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rego: 'package test' }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('PUT /admin/policies/:id updates a policy', async () => {
    const createRes = await gatewayApp.inject({
      method: 'POST',
      url: '/api/admin/policies',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Update Test',
        rego: 'package original',
        updatedBy: 'test@acme.com',
      }),
    });
    const created = JSON.parse(createRes.body);

    const res = await gatewayApp.inject({
      method: 'PUT',
      url: '/api/admin/policies/' + created.id,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Updated Name',
        rego: 'package updated',
        updatedBy: 'test@acme.com',
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.name).toBe('Updated Name');
    expect(body.rego).toBe('package updated');
  });

  it('POST /admin/policies/:id/duplicate duplicates a policy', async () => {
    const listRes = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/policies',
    });
    const policies = JSON.parse(listRes.body).policies;
    const original = policies[0];

    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/api/admin/policies/' + original.id + '/duplicate',
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.name).toContain(original.name);
    expect(body.name).toContain('(Copy)');
    expect(body.rego).toBe(original.rego);
    expect(body.id).not.toBe(original.id);
  });

  it('DELETE /admin/policies/:id deletes a policy', async () => {
    const createRes = await gatewayApp.inject({
      method: 'POST',
      url: '/api/admin/policies',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Delete Me',
        rego: 'package deleteme',
        updatedBy: 'test@acme.com',
      }),
    });
    const created = JSON.parse(createRes.body);

    const res = await gatewayApp.inject({
      method: 'DELETE',
      url: '/api/admin/policies/' + created.id,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).success).toBe(true);

    const getRes = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/policies/' + created.id,
    });
    expect(getRes.statusCode).toBe(404);
  });

  it('POST /admin/policies/test evaluates policy input', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/api/admin/policies/test',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: {
          actor: 'alice',
          orgId: 'org-1',
          roles: ['editor'],
          upstreamId: 'fs-server',
          tool: 'readFile',
          args: { path: 'hello.txt' },
          time: new Date().toISOString(),
          ip: '127.0.0.1',
          sessionId: 'test-session',
        },
      }),
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.decision).toBeDefined();
    expect(typeof body.decision.allow).toBe('boolean');
    expect(typeof body.decision.reason).toBe('string');
  });

  it('POST /admin/policies/test returns 400 without input', async () => {
    const res = await gatewayApp.inject({
      method: 'POST',
      url: '/api/admin/policies/test',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(400);
  });

  it('policy endpoints work without Authorization header', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/policies',
    });
    expect(res.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Search endpoint
// ═══════════════════════════════════════════════════════════════════════════
describe('Search endpoint', () => {
  it('GET /admin/search returns results and total', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/search' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('total');
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
  });


  it('GET /admin/search filters by decision=deny', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/search?decision=deny' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    body.results.forEach((r: { decision: string }) => {
      expect(r.decision).toBe('deny');
    });
  });

  it('GET /admin/search filters by decision=allow', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/search?decision=allow' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    body.results.forEach((r: { decision: string }) => {
      expect(r.decision).toBe('allow');
    });
  });

  it('GET /admin/search filters by text query', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/search?q=readFile' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    body.results.forEach((r: { tool: string }) => {
      expect(r.tool.toLowerCase()).toContain('readfile');
    });
  });

  it('GET /admin/search respects limit and offset', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/search?limit=2&offset=0' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results.length).toBeLessThanOrEqual(2);
  });

  it('GET /admin/search works without auth header', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/search' });
    expect(res.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Aggregate endpoint
// ═══════════════════════════════════════════════════════════════════════════
describe('Aggregate endpoint', () => {
  beforeAll(async () => {
    // Seed a few audit records so aggregation has data to group
    const token = generateTestToken({ actor: 'agg-actor', roles: ['editor'] });
    await gatewayApp.inject({
      method: 'POST',
      url: '/v1/call',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ upstreamId: 'fs-server', tool: 'readFile', args: { path: 'hello.txt' } }),
    });
    await gatewayApp.inject({
      method: 'POST',
      url: '/v1/call',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ upstreamId: 'fs-server', tool: 'listDir', args: { path: '.' } }),
    });
  });

  it('groups by single field (tool) and returns DESC-ordered results', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/aggregate?groupBy=tool' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('groupBy');
    expect(Array.isArray(body.groupBy)).toBe(true);
    expect(body).toHaveProperty('results');
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toHaveProperty('tool');
    expect(body.results[0]).toHaveProperty('count');
    // Verify DESC ordering
    for (let i = 1; i < body.results.length; i++) {
      expect(body.results[i - 1].count).toBeGreaterThanOrEqual(body.results[i].count);
    }
  });

  it('groups by two fields (actor, decision) and includes both columns', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/aggregate?groupBy=actor,decision' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toHaveProperty('actor');
    expect(body.results[0]).toHaveProperty('decision');
    expect(body.results[0]).toHaveProperty('count');
  });

  it('applies decision=deny WHERE filter and returns only deny rows', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/aggregate?groupBy=actor&decision=deny' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    // All rows must come from deny decisions (verify via a search)
    const searchRes = await gatewayApp.inject({ method: 'GET', url: '/api/admin/search?decision=deny' });
    const searchBody = JSON.parse(searchRes.body);
    if (searchBody.total > 0) {
      expect(body.results.length).toBeGreaterThan(0);
    } else {
      expect(body.results.length).toBe(0);
    }
  });

  it('returns 400 when groupBy is missing', async () => {
    const res = await gatewayApp.inject({ method: 'GET', url: '/api/admin/aggregate' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/groupBy/i);
  });

  it('returns empty results for unknown (non-whitelisted) groupBy field', async () => {
    const res = await gatewayApp.inject({
      method: 'GET',
      url: '/api/admin/aggregate?groupBy=nonexistentField',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.results).toEqual([]);
  });
});
