import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { buildServeConfig, validateServeOpts, ServeOpts } from '../../src/commands/serve';
import { RateLimiter } from '../../src/services/ratelimit';

function baseOpts(overrides: Partial<ServeOpts> = {}): ServeOpts {
  return {
    port: 3000,
    bind: '127.0.0.1',
    dataDir: path.join(os.tmpdir(), 'oculi-serve-test'),
    ...overrides,
  };
}

describe('buildServeConfig — zero-config localhost', () => {
  it('produces no-auth, no-rate-limit, no-OPA, empty upstreams', () => {
    const cfg = buildServeConfig(baseOpts());
    expect(cfg.jwtSecret).toBe('');
    expect(cfg.rateLimitCapacity).toBe(0);
    expect(cfg.rateLimitRefillPerSecond).toBe(0);
    expect(cfg.opaEnabled).toBe(false);
    expect(cfg.upstreams).toEqual([]);
    expect(cfg.dbPath).toBe(path.join(baseOpts().dataDir, 'oculi.db'));
  });

  it('honors localhost aliases (localhost, ::1)', () => {
    for (const bind of ['localhost', '::1', '127.0.0.1']) {
      const cfg = buildServeConfig(baseOpts({ bind }));
      expect(cfg.rateLimitCapacity).toBe(0);
    }
  });
});

describe('buildServeConfig — non-localhost bind', () => {
  it('enables rate limiting with 10/2 defaults', () => {
    const cfg = buildServeConfig(baseOpts({ bind: '0.0.0.0', auth: 'x'.repeat(32) }));
    expect(cfg.rateLimitCapacity).toBe(10);
    expect(cfg.rateLimitRefillPerSecond).toBe(2);
  });

  it('passes auth secret into jwtSecret', () => {
    const cfg = buildServeConfig(baseOpts({ bind: '0.0.0.0', auth: 'x'.repeat(40) }));
    expect(cfg.jwtSecret).toBe('x'.repeat(40));
  });

  it('enables OPA when --opa-url is given', () => {
    const cfg = buildServeConfig(baseOpts({ opaUrl: 'http://opa.local:8181' }));
    expect(cfg.opaEnabled).toBe(true);
    expect(cfg.opaUrl).toBe('http://opa.local:8181');
  });
});

describe('buildServeConfig — verbose flag', () => {
  it('sets logLevel to info when verbose is true', () => {
    const cfg = buildServeConfig(baseOpts({ verbose: true }));
    expect(cfg.logLevel).toBe('info');
  });

  it('sets logLevel to warn when verbose is false', () => {
    const cfg = buildServeConfig(baseOpts({ verbose: false }));
    expect(cfg.logLevel).toBe('warn');
  });

  it('sets logLevel to warn when verbose is undefined', () => {
    const cfg = buildServeConfig(baseOpts());
    expect(cfg.logLevel).toBe('warn');
  });
});

describe('validateServeOpts — auth required on non-localhost', () => {
  const origEnv = process.env.OCULI_GATEWAY_TOKEN;
  beforeEach(() => {
    delete process.env.OCULI_GATEWAY_TOKEN;
  });
  afterEach(() => {
    if (origEnv) process.env.OCULI_GATEWAY_TOKEN = origEnv;
  });

  it('localhost without auth: OK', () => {
    expect(() => validateServeOpts(baseOpts())).not.toThrow();
  });

  it('non-localhost without auth: rejects', () => {
    expect(() => validateServeOpts(baseOpts({ bind: '0.0.0.0' }))).toThrow(/requires authentication/);
  });

  it('non-localhost with short auth: rejects', () => {
    expect(() => validateServeOpts(baseOpts({ bind: '0.0.0.0', auth: 'shortsecret' }))).toThrow(/at least 32/);
  });

  it('non-localhost with adequate auth: OK', () => {
    expect(() => validateServeOpts(baseOpts({ bind: '0.0.0.0', auth: 'x'.repeat(32) }))).not.toThrow();
  });

  it('non-localhost via env-var fallback (OCULI_GATEWAY_TOKEN): OK', () => {
    process.env.OCULI_GATEWAY_TOKEN = 'x'.repeat(40);
    expect(() => validateServeOpts(baseOpts({ bind: '0.0.0.0' }))).not.toThrow();
  });
});

describe('RateLimiter — capacity=0 short-circuit', () => {
  it('always allows when capacity is 0', () => {
    const rl = new RateLimiter(0, 0);
    for (let i = 0; i < 1000; i++) {
      const r = rl.check('any-key');
      expect(r.allowed).toBe(true);
    }
  });

  it('still enforces when capacity > 0', () => {
    const rl = new RateLimiter(2, 0);
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(true);
    expect(rl.check('k').allowed).toBe(false);
  });
});
