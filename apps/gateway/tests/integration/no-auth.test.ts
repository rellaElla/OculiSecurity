import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { buildServer } from '../../src/server';
import { AppConfig } from '../../src/config';

/**
 * Boots the gateway with `jwtSecret: ''` (no-auth mode, the way `oculi serve`
 * runs zero-config on localhost) and confirms:
 *   1. The startup-time JWT validation is bypassed by going through buildServer
 *      directly (loadConfig still throws on empty secret, but buildServer doesn't).
 *   2. Endpoints that normally require Bearer tokens (e.g. /api/admin/logs) are
 *      reachable — the auth middleware injects a synthetic admin actor.
 *   3. The hook ingestion path still works exactly the same.
 */

let app: FastifyInstance;
let dbPath: string;

beforeAll(async () => {
  dbPath = path.join(os.tmpdir(), `no-auth-test-${Date.now()}.db`);
  const config: AppConfig = {
    port: 0,
    jwtSecret: '',
    opaUrl: 'http://localhost:8181',
    opaEnabled: false,
    dbPath,
    storeFullArgs: false,
    upstreams: [],
    rateLimitCapacity: 0,
    rateLimitRefillPerSecond: 0,
    logLevel: 'silent',
  };
  const built = await buildServer(config);
  app = built.app;
});

afterAll(async () => {
  await app?.close();
  if (dbPath && fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }
});

describe('No-auth mode (oculi serve localhost)', () => {
  it('/health reachable without any token', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('/api/admin/logs reachable without Bearer token (synthetic actor)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/logs' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.logs)).toBe(true);
  });

  it('/v1/hooks ingestion works without token (CLI emit path)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'echo ok' },
        session_id: 'no-auth-test',
        cwd: '/tmp',
      }),
    });
    expect(res.statusCode).toBe(200);
  });

  it('X-Oculi-Local-Decision header still records denies via pre-decided fast path', async () => {
    const sessionId = 'no-auth-deny-' + Date.now();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hooks',
      headers: {
        'Content-Type': 'application/json',
        'X-Oculi-Local-Decision': 'deny',
        'X-Oculi-Local-Reason': 'Blocked by Oculi rule: no-rm-rf',
      },
      body: JSON.stringify({
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'echo x' },
        session_id: sessionId,
        cwd: '/tmp',
      }),
    });
    expect(res.statusCode).toBe(200);

    const search = await app.inject({
      method: 'GET',
      url: '/api/admin/search?decision=deny&limit=50',
    });
    const body = JSON.parse(search.body) as { results: Array<{ sessionId: string; reason: string; decision: string }> };
    const found = body.results.find((r) => r.sessionId === sessionId);
    expect(found).toBeDefined();
    expect(found!.decision).toBe('deny');
    expect(found!.reason).toBe('Blocked by Oculi rule: no-rm-rf');
  });
});
