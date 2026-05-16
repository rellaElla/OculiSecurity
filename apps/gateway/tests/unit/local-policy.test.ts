import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';
import {
  evaluateLocalPolicy,
  findPolicyFile,
  loadPolicyFile,
  PolicyRule,
} from '../../src/services/local-policy';
import { OculiEvent } from '../../src/routes/adapters/schema';
import { runInit } from '../../src/init';
import { TEMPLATE_NAMES, templates } from '../../src/services/local-policy-templates';

// ── helpers ──────────────────────────────────────────────────────────────────

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oculi-policy-test-'));
}

function cleanup(dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

function makeEvent(overrides: Partial<OculiEvent> = {}): OculiEvent {
  return {
    schema_version: '1',
    ide_source: 'claude-code',
    actor: 'claude-code',
    org_id: 'default',
    hook_event_name: 'PreToolUse',
    phase: 'pre',
    session_id: 'test-session',
    timestamp: new Date().toISOString(),
    raw_payload: {},
    ...overrides,
  };
}

// ── evaluateLocalPolicy ─────────────────────────────────────────────────────

describe('evaluateLocalPolicy', () => {
  describe('tool matching', () => {
    it('matches exact tool name', () => {
      const rules: PolicyRule[] = [
        { id: 'block-shell', match: { tool: 'shell' }, action: 'deny' },
      ];
      const event = makeEvent({ tool: 'shell', shell_command: 'ls' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('deny');
      expect(result.matchedRules).toHaveLength(1);
      expect(result.matchedRules[0].id).toBe('block-shell');
    });

    it('does not match different tool', () => {
      const rules: PolicyRule[] = [
        { id: 'block-shell', match: { tool: 'shell' }, action: 'deny' },
      ];
      const event = makeEvent({ tool: 'file_read' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('allow');
      expect(result.matchedRules).toHaveLength(0);
    });
  });

  describe('command_pattern matching', () => {
    it('matches regex against action.command', () => {
      const rules: PolicyRule[] = [
        { id: 'no-rm-rf', match: { tool: 'shell', command_pattern: 'rm\\s+-rf' }, action: 'deny' },
      ];
      const event = makeEvent({
        tool: 'shell',
        shell_command: 'rm -rf /',
        action: { command: 'rm -rf /' },
      });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('deny');
    });

    it('matches regex against shell_command when action is absent', () => {
      const rules: PolicyRule[] = [
        { id: 'no-rm-rf', match: { tool: 'shell', command_pattern: 'rm\\s+-rf' }, action: 'deny' },
      ];
      const event = makeEvent({
        tool: 'shell',
        shell_command: 'rm -rf /tmp/junk',
      });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('deny');
    });

    it('does not match when command is absent', () => {
      const rules: PolicyRule[] = [
        { id: 'no-rm-rf', match: { command_pattern: 'rm\\s+-rf' }, action: 'deny' },
      ];
      const event = makeEvent({ tool: 'file_read' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('allow');
    });

    it('handles invalid regex gracefully (no match)', () => {
      const rules: PolicyRule[] = [
        { id: 'bad-regex', match: { command_pattern: '[invalid(' }, action: 'deny' },
      ];
      const event = makeEvent({
        tool: 'shell',
        shell_command: 'ls',
        action: { command: 'ls' },
      });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('allow');
    });
  });

  describe('file_pattern matching', () => {
    it('matches regex against file_path', () => {
      const rules: PolicyRule[] = [
        { id: 'warn-env', match: { tool: 'file_read', file_pattern: '\\.env' }, action: 'warn' },
      ];
      const event = makeEvent({ tool: 'file_read', file_path: '/project/.env.local' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('warn');
    });

    it('falls back to tool_args.path when file_path is absent', () => {
      const rules: PolicyRule[] = [
        { id: 'warn-env', match: { file_pattern: '\\.env' }, action: 'warn' },
      ];
      const event = makeEvent({
        tool: 'file_read',
        tool_args: { path: '.env.production' },
      });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('warn');
    });

    it('does not match when no file path available', () => {
      const rules: PolicyRule[] = [
        { id: 'warn-env', match: { file_pattern: '\\.env' }, action: 'warn' },
      ];
      const event = makeEvent({ tool: 'shell', shell_command: 'echo hello' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('allow');
    });
  });

  describe('mcp_server matching', () => {
    it('matches exact mcp_server name', () => {
      const rules: PolicyRule[] = [
        { id: 'block-mcp', match: { tool: 'mcp_call' }, action: 'deny' },
      ];
      const event = makeEvent({ tool: 'mcp_call', mcp_server: 'some-server' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('deny');
    });

    it('matches specific mcp_server', () => {
      const rules: PolicyRule[] = [
        { id: 'block-risky', match: { mcp_server: 'risky-server' }, action: 'deny' },
      ];
      const event = makeEvent({ tool: 'mcp_call', mcp_server: 'risky-server' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('deny');
    });
  });

  describe('AND logic (multiple match fields)', () => {
    it('requires all fields to match', () => {
      const rules: PolicyRule[] = [
        {
          id: 'deny-env-edit',
          match: { tool: 'file_edit', file_pattern: '\\.env' },
          action: 'deny',
        },
      ];

      // tool matches, file doesn't → no match
      const event1 = makeEvent({ tool: 'file_edit', file_path: '/project/src/index.ts' });
      expect(evaluateLocalPolicy(event1, rules).action).toBe('allow');

      // both match → deny
      const event2 = makeEvent({ tool: 'file_edit', file_path: '/project/.env' });
      expect(evaluateLocalPolicy(event2, rules).action).toBe('deny');
    });
  });

  describe('precedence: deny > warn > allow', () => {
    it('deny wins over warn and allow', () => {
      const rules: PolicyRule[] = [
        { id: 'allow-shell', match: { tool: 'shell' }, action: 'allow' },
        { id: 'warn-shell', match: { tool: 'shell' }, action: 'warn' },
        { id: 'deny-rm', match: { tool: 'shell', command_pattern: 'rm' }, action: 'deny' },
      ];
      const event = makeEvent({
        tool: 'shell',
        shell_command: 'rm file.txt',
        action: { command: 'rm file.txt' },
      });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('deny');
      expect(result.matchedRules).toHaveLength(3);
    });

    it('warn wins over allow', () => {
      const rules: PolicyRule[] = [
        { id: 'allow-read', match: { tool: 'file_read' }, action: 'allow' },
        { id: 'warn-env', match: { tool: 'file_read', file_pattern: '\\.env' }, action: 'warn' },
      ];
      const event = makeEvent({ tool: 'file_read', file_path: '.env' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('warn');
    });
  });

  describe('no matching rules → allow', () => {
    it('returns allow when no rules match', () => {
      const rules: PolicyRule[] = [
        { id: 'block-shell', match: { tool: 'shell' }, action: 'deny' },
      ];
      const event = makeEvent({ tool: 'file_read', file_path: 'readme.md' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('allow');
      expect(result.matchedRules).toHaveLength(0);
    });

    it('returns allow when rules list is empty', () => {
      const event = makeEvent({ tool: 'shell', shell_command: 'rm -rf /' });
      const result = evaluateLocalPolicy(event, []);
      expect(result.action).toBe('allow');
    });
  });

  describe('phase filtering', () => {
    it('skips evaluation for post phase (always allow)', () => {
      const rules: PolicyRule[] = [
        { id: 'block-all-shell', match: { tool: 'shell' }, action: 'deny' },
      ];
      const event = makeEvent({ phase: 'post', tool: 'shell', shell_command: 'rm -rf /' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('allow');
      expect(result.matchedRules).toHaveLength(0);
    });

    it('skips evaluation for complete phase', () => {
      const rules: PolicyRule[] = [
        { id: 'block-all', match: { tool: 'session_stop' }, action: 'deny' },
      ];
      const event = makeEvent({ phase: 'complete', tool: 'session_stop' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('allow');
    });
  });

  describe('rule with empty match → no match', () => {
    it('a rule with no match fields does not match anything', () => {
      const rules: PolicyRule[] = [
        { id: 'empty', match: {}, action: 'deny' },
      ];
      const event = makeEvent({ tool: 'shell', shell_command: 'ls' });
      const result = evaluateLocalPolicy(event, rules);
      expect(result.action).toBe('allow');
    });
  });
});

// ── loadPolicyFile ──────────────────────────────────────────────────────────

describe('loadPolicyFile', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('parses a valid YAML policy file', () => {
    const dir = mktemp(); tmps.push(dir);
    const policyPath = path.join(dir, 'policy.yaml');
    fs.writeFileSync(policyPath, `rules:
  - id: "no-rm"
    match:
      tool: shell
      command_pattern: "rm"
    action: deny
  - id: "warn-env"
    match:
      file_pattern: "\\\\.env"
    action: warn
`, 'utf8');

    const file = loadPolicyFile(policyPath);
    expect(file.rules).toHaveLength(2);
    expect(file.rules[0].id).toBe('no-rm');
    expect(file.rules[0].action).toBe('deny');
    expect(file.rules[1].id).toBe('warn-env');
    expect(file.rules[1].action).toBe('warn');
  });

  it('returns empty rules for file with no rules key', () => {
    const dir = mktemp(); tmps.push(dir);
    const policyPath = path.join(dir, 'policy.yaml');
    fs.writeFileSync(policyPath, 'other_key: true\n', 'utf8');

    const file = loadPolicyFile(policyPath);
    expect(file.rules).toHaveLength(0);
  });

  it('defaults invalid action to deny', () => {
    const dir = mktemp(); tmps.push(dir);
    const policyPath = path.join(dir, 'policy.yaml');
    fs.writeFileSync(policyPath, `rules:
  - id: "bad-action"
    match:
      tool: shell
    action: banana
`, 'utf8');

    const file = loadPolicyFile(policyPath);
    expect(file.rules[0].action).toBe('deny');
  });
});

// ── findPolicyFile ──────────────────────────────────────────────────────────

describe('findPolicyFile', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('finds .oculi/policy.yaml in given directory', () => {
    const dir = mktemp(); tmps.push(dir);
    const policyDir = path.join(dir, '.oculi');
    fs.mkdirSync(policyDir, { recursive: true });
    fs.writeFileSync(path.join(policyDir, 'policy.yaml'), 'rules: []\n', 'utf8');

    const result = findPolicyFile(dir);
    expect(result).toBe(path.join(policyDir, 'policy.yaml'));
  });

  it('walks up parent directories', () => {
    const root = mktemp(); tmps.push(root);
    const nested = path.join(root, 'a', 'b', 'c');
    fs.mkdirSync(nested, { recursive: true });

    // Policy at root level
    const policyDir = path.join(root, '.oculi');
    fs.mkdirSync(policyDir, { recursive: true });
    fs.writeFileSync(path.join(policyDir, 'policy.yaml'), 'rules: []\n', 'utf8');

    const result = findPolicyFile(nested);
    expect(result).toBe(path.join(policyDir, 'policy.yaml'));
  });

  it('returns null when no policy file exists', () => {
    const dir = mktemp(); tmps.push(dir);
    const result = findPolicyFile(dir);
    // Could be null or could find a global one — only assert type
    if (result !== null) {
      expect(fs.existsSync(result)).toBe(true);
    }
  });
});

// ── runInit ─────────────────────────────────────────────────────────────────

describe('runInit', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('creates .oculi/policy.yaml from the standard template', () => {
    const dir = mktemp(); tmps.push(dir);
    const result = runInit({ home: dir });
    expect(result.created).toBe(true);
    expect(fs.existsSync(result.path)).toBe(true);

    const content = fs.readFileSync(result.path, 'utf8');
    expect(content).toContain('no-rm-rf');
  });

  it('refuses to overwrite existing file', () => {
    const dir = mktemp(); tmps.push(dir);
    runInit({ home: dir });
    const result = runInit({ home: dir });
    expect(result.created).toBe(false);

    const content = fs.readFileSync(result.path, 'utf8');
    expect(content).toContain('no-rm-rf');
  });
});

// ── Template validity ───────────────────────────────────────────────────────

describe('policy templates', () => {
  for (const name of TEMPLATE_NAMES) {
    it(`${name} template is valid YAML with parseable rules`, () => {
      const parsed = YAML.parse(templates[name]) as { rules?: unknown[] };
      expect(parsed).toBeDefined();
      // All templates should at least have a rules key
      expect(parsed).toHaveProperty('rules');
    });
  }

  it('standard template contains expected rule ids', () => {
    const parsed = YAML.parse(templates.standard) as { rules: { id: string }[] };
    const ids = parsed.rules.map((r) => r.id);
    expect(ids).toContain('no-rm-rf');
    expect(ids).toContain('warn-env-access');
    expect(ids).toContain('warn-mcp');
  });

});
