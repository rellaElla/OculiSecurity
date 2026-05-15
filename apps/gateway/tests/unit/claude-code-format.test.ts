import { describe, it, expect } from 'vitest';
import {
  formatAllow,
  formatDeny,
  formatWarn,
  parseClaudeCodeEvent,
} from '../../src/routes/adapters/claude-code';
import type { OculiEvent } from '../../src/routes/adapters/schema';

function ccEvent(hookEvent: string, command = 'echo hi'): OculiEvent {
  return parseClaudeCodeEvent(
    JSON.stringify({
      hook_event_name: hookEvent,
      tool_name: 'Bash',
      tool_input: { command },
      session_id: 'fmt-test',
      cwd: '/tmp',
    }),
    hookEvent,
  );
}

describe('claude-code formatters: PreToolUse', () => {
  const event = ccEvent('PreToolUse');

  it('formatAllow returns empty object', () => {
    expect(JSON.parse(formatAllow(event))).toEqual({});
  });

  it('formatDeny returns modern hookSpecificOutput shape', () => {
    const out = JSON.parse(formatDeny('Blocked by Oculi rule: no-rm-rf', event));
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'Blocked by Oculi rule: no-rm-rf',
      },
    });
  });

  it('formatDeny puts no top-level decision field (legacy shape removed)', () => {
    const out = JSON.parse(formatDeny('any reason', event));
    expect(out.decision).toBeUndefined();
    expect(out.reason).toBeUndefined();
  });

  it('formatWarn returns systemMessage shape', () => {
    const out = JSON.parse(formatWarn('Oculi warning: warn-env-access', event));
    expect(out).toEqual({ systemMessage: 'Oculi warning: warn-env-access' });
  });
});

describe('claude-code formatters: PostToolUse', () => {
  const event = ccEvent('PostToolUse');

  it('formatAllow returns empty object', () => {
    expect(JSON.parse(formatAllow(event))).toEqual({});
  });

  it('formatDeny returns top-level decision: block (prevents Claude from continuing)', () => {
    const out = JSON.parse(formatDeny('post-hoc policy violation', event));
    expect(out).toEqual({ decision: 'block', reason: 'post-hoc policy violation' });
    expect(out.hookSpecificOutput).toBeUndefined();
  });

  it('formatWarn returns empty object (no warn channel for post)', () => {
    expect(JSON.parse(formatWarn('whatever', event))).toEqual({});
  });
});

describe('claude-code formatters: Stop', () => {
  const event = ccEvent('Stop');

  it('formatAllow returns empty object', () => {
    expect(JSON.parse(formatAllow(event))).toEqual({});
  });

  it('formatWarn returns empty object', () => {
    expect(JSON.parse(formatWarn('whatever', event))).toEqual({});
  });
});
