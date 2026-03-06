import { describe, it, expect } from 'vitest';
import { sanitizeResponse } from '../../src/services/sanitizer';
import { PolicyDecision } from '../../src/types';

function makeDecision(overrides: Partial<PolicyDecision> = {}): PolicyDecision {
  return {
    allow: true,
    reason: 'allowed',
    redactions: {},
    transforms: {},
    ...overrides,
  };
}

describe('sanitizeResponse', () => {
  it('returns primitive values unchanged', () => {
    expect(sanitizeResponse('hello', makeDecision())).toBe('hello');
    expect(sanitizeResponse(42, makeDecision())).toBe(42);
    expect(sanitizeResponse(null, makeDecision())).toBeNull();
  });

  it('passes through objects with no redactions', () => {
    const payload = { content: 'file contents', path: 'hello.txt' };
    const result = sanitizeResponse(payload, makeDecision()) as typeof payload;
    expect(result.content).toBe('file contents');
    expect(result.path).toBe('hello.txt');
  });

  it('redacts sensitive fields', () => {
    const payload = {
      content: 'some data',
      password: 'hunter2',
      token: 'abc123',
    };

    const decision = makeDecision({
      redactions: { password: true, token: true },
    });

    const result = sanitizeResponse(payload, decision) as Record<string, unknown>;
    expect(result.content).toBe('some data');
    expect(result.password).toBe('[REDACTED]');
    expect(result.token).toBe('[REDACTED]');
  });

  it('redacts nested sensitive fields', () => {
    const payload = {
      data: {
        apiKey: 'sk-secret',
        name: 'alice',
      },
    };

    const decision = makeDecision({
      redactions: { apiKey: true },
    });

    const result = sanitizeResponse(payload, decision) as { data: Record<string, unknown> };
    expect(result.data.apiKey).toBe('[REDACTED]');
    expect(result.data.name).toBe('alice');
  });

  it('truncates long strings via transform', () => {
    const payload = { content: 'A'.repeat(2000) };

    const decision = makeDecision({
      transforms: {
        content: { type: 'truncate', maxLength: 100 },
      },
    });

    const result = sanitizeResponse(payload, decision) as { content: string };
    expect(result.content.length).toBeLessThan(200);
    expect(result.content).toContain('[truncated');
  });

  it('masks fields via transform', () => {
    const payload = { secretKey: 'my-secret-value' };

    const decision = makeDecision({
      transforms: {
        secretKey: { type: 'mask', mask: '***masked***' },
      },
    });

    const result = sanitizeResponse(payload, decision) as { secretKey: string };
    expect(result.secretKey).toBe('***masked***');
  });

  it('removes fields via transform', () => {
    const payload = { data: 'visible', internal: 'hidden' };

    const decision = makeDecision({
      transforms: {
        internal: { type: 'remove' },
      },
    });

    const result = sanitizeResponse(payload, decision) as Record<string, unknown>;
    expect(result.data).toBe('visible');
    expect(Object.keys(result)).not.toContain('internal');
  });

  it('handles arrays of objects', () => {
    const payload = [
      { name: 'file1.txt', password: 'secret1' },
      { name: 'file2.txt', password: 'secret2' },
    ];

    const decision = makeDecision({ redactions: { password: true } });

    const result = sanitizeResponse(payload, decision) as Array<Record<string, unknown>>;
    expect(result[0].name).toBe('file1.txt');
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].password).toBe('[REDACTED]');
  });

  it('transform takes precedence over redaction when both apply', () => {
    const payload = { token: 'my-token-value' };

    const decision = makeDecision({
      redactions: { token: true },
      transforms: { token: { type: 'mask', mask: '[TOKEN]' } },
    });

    const result = sanitizeResponse(payload, decision) as Record<string, unknown>;
    // Transform wins
    expect(result.token).toBe('[TOKEN]');
  });
});
