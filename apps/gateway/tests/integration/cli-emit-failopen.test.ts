/**
 * Integration tests: spawn the built `oculi emit claude-code PreToolUse`
 * binary and assert exit code, stdout, stderr for the fail-open paths.
 *
 * Locks in the contract: when the gateway is unreachable OR returns non-2xx,
 * the CLI defers to localDecision (which defaults to 'allow' when no policy
 * file is in scope), prints a fail-open warning to stderr, and exits 0.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawn, execFileSync } from 'child_process';
import http from 'http';
import path from 'path';
import os from 'os';
import fs from 'fs';

const CLI_PATH = path.resolve(__dirname, '../../dist/cli.js');
const PAYLOAD = JSON.stringify({
  session_id: 'test-session',
  transcript_path: '/tmp/t',
  cwd: '/tmp',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello', description: 'test' },
});

beforeAll(() => {
  // Ensure dist/cli.js is fresh — the CLI is the artifact under test.
  if (!fs.existsSync(CLI_PATH)) {
    execFileSync('npm', ['run', 'build'], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'inherit',
    });
  }
});

interface FakeGateway {
  url: string;
  close: () => Promise<void>;
}

function startFakeGateway(handler: http.RequestListener): Promise<FakeGateway> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('no address');
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function runEmit(opts: {
  gatewayUrl: string;
  cwd?: string;
  payload?: string;
}): Promise<{ status: number; stdout: string; stderr: string }> {
  // Async spawn (not spawnSync) so the test process's event loop keeps running
  // and the in-process fake gateway can accept the child's HTTP request.
  // Per-call HOME so the CLI's telemetry doesn't pollute the shared tmp root
  // (which would leak `.oculi/` directories that other tests' walk-up logic finds).
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oculi-home-'));
  const cwd = opts.cwd ?? home;
  return new Promise((resolve) => {
    const child = spawn('node', [CLI_PATH, 'emit', 'claude-code', 'PreToolUse'], {
      cwd,
      env: { ...process.env, GATEWAY_URL: opts.gatewayUrl, HOME: home },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => resolve({ status: code ?? -1, stdout, stderr }));
    child.stdin.end(opts.payload ?? PAYLOAD);
  });
}

function withPolicy(action: 'allow' | 'deny' | 'warn', ruleId: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oculi-test-'));
  fs.mkdirSync(path.join(dir, '.oculi'));
  fs.writeFileSync(
    path.join(dir, '.oculi', 'policy.yaml'),
    `rules:\n  - id: ${ruleId}\n    match:\n      tool: shell\n    action: ${action}\n`,
  );
  return dir;
}

describe('cli emit — fail-open paths', () => {
  it('gateway unreachable + no local policy → exit 0, allow', async () => {
    // Use port 1 which is reserved and refuses connections.
    const r = await runEmit({ gatewayUrl: 'http://127.0.0.1:1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}');
    expect(r.stderr).toContain('gateway unreachable');
    expect(r.stdout).not.toContain('"permissionDecision":"deny"');
  });

  it('gateway unreachable + local allow rule → exit 0, allow', async () => {
    const cwd = withPolicy('allow', 'shell-allow');
    const r = await runEmit({ gatewayUrl: 'http://127.0.0.1:1', cwd });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{}');
    expect(r.stderr).toContain('gateway unreachable');
  });

  it('gateway unreachable + local deny rule → exit 0, deny with rule id', async () => {
    const cwd = withPolicy('deny', 'shell-deny');
    const r = await runEmit({ gatewayUrl: 'http://127.0.0.1:1', cwd });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"permissionDecision":"deny"');
    expect(r.stdout).toContain('shell-deny');
    expect(r.stderr).toContain('gateway unreachable');
  });

  it('gateway returns 500 + no local policy → exit 0, allow', async () => {
    const gw = await startFakeGateway((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal' }));
    });
    try {
      const r = await runEmit({ gatewayUrl: gw.url });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('{}');
      expect(r.stderr).toContain('gateway error 500');
      expect(r.stdout).not.toContain('"permissionDecision":"deny"');
    } finally {
      await gw.close();
    }
  });

  it('gateway returns 401 + no local policy → exit 0, allow (real user-observed case)', async () => {
    const gw = await startFakeGateway((_req, res) => {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
    });
    try {
      const r = await runEmit({ gatewayUrl: gw.url });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('{}');
      expect(r.stderr).toContain('gateway error 401');
      expect(r.stdout).not.toContain('"permissionDecision":"deny"');
    } finally {
      await gw.close();
    }
  });

  it('gateway returns 500 + local deny rule → exit 0, deny with rule id', async () => {
    const gw = await startFakeGateway((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    const cwd = withPolicy('deny', 'shell-deny');
    try {
      const r = await runEmit({ gatewayUrl: gw.url, cwd });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('"permissionDecision":"deny"');
      expect(r.stdout).toContain('shell-deny');
      expect(r.stderr).toContain('gateway error 500');
    } finally {
      await gw.close();
    }
  });
});
