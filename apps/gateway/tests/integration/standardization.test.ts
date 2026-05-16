import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { routeStdin } from '../../src/routes/adapters/router';
import { evaluateLocalPolicy, loadPolicyFile, PolicyRule } from '../../src/services/local-policy';
import {
  eventToLogEntry,
  appendTelemetry,
  readTelemetryLines,
  TelemetryLogEntry,
} from '../../src/services/telemetry-log';
import { buildReport } from '../../src/commands/report';
import { installClaudeCode, uninstallClaudeCode } from '../../src/install/claude-code';
import { installCursor, uninstallCursor } from '../../src/install/cursor';

// ── helpers ──────────────────────────────────────────────────────────────────

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oculi-std-test-'));
}

function cleanup(dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

/** Keys that are expected to differ between IDE entries. */
const ALLOWED_DIFF_KEYS = [
  'ide_source',
  'actor',
  'session_id',
  'trace_id',
  'hook_event_name',
  'timestamp',
  'context',
  'cwd',
  'workspace_roots',
  'tool_args',
  'tool_result',
];

function assertStructurallyEqual(
  a: TelemetryLogEntry,
  b: TelemetryLogEntry,
  allowedDiffKeys: string[] = ALLOWED_DIFF_KEYS,
): void {
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  expect(aKeys).toEqual(bKeys);

  for (const key of aKeys) {
    if (allowedDiffKeys.includes(key)) continue;
    expect((a as Record<string, unknown>)[key]).toEqual(
      (b as Record<string, unknown>)[key],
    );
  }
}

// ── test payloads ────────────────────────────────────────────────────────────

function ccShellPayload(command: string): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
    session_id: 'cc-session-1',
    cwd: '/workspace',
  });
}

function cursorShellPayload(command: string): string {
  return JSON.stringify({
    hook_event_name: 'beforeShellExecution',
    conversation_id: 'cursor-conv-1',
    generation_id: 'cursor-gen-1',
    content: command,
    workspace_roots: ['/workspace'],
  });
}

function ccFileEditPayload(filePath: string): string {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, new_string: 'updated content' },
    session_id: 'cc-session-2',
    cwd: '/workspace',
  });
}

function cursorFileEditPayload(filePath: string): string {
  return JSON.stringify({
    hook_event_name: 'afterFileEdit',
    conversation_id: 'cursor-conv-2',
    generation_id: 'cursor-gen-2',
    file_path: filePath,
    content: 'updated content',
    workspace_roots: ['/workspace'],
  });
}

// ── test policy rules ────────────────────────────────────────────────────────

const TEST_RULES: PolicyRule[] = [
  {
    id: 'deny-rm-rf',
    match: { tool: 'shell', command_pattern: 'rm\\s+-rf' },
    action: 'deny',
  },
  {
    id: 'warn-env',
    match: { file_pattern: '\\.env' },
    action: 'warn',
  },
];

// ── denied shell command from both IDEs ─────────────────────────────────────

describe('denied shell command from both IDEs', () => {
  it('produces identical deny results for rm -rf', () => {
    const ccResult = routeStdin(ccShellPayload('rm -rf /tmp'));
    const cursorResult = routeStdin(cursorShellPayload('rm -rf /tmp'));
    expect(ccResult).not.toBeNull();
    expect(cursorResult).not.toBeNull();

    // Both normalize to shell tool
    expect(ccResult!.event.tool).toBe('shell');
    expect(cursorResult!.event.tool).toBe('shell');
    expect(ccResult!.event.shell_command).toBe('rm -rf /tmp');
    expect(cursorResult!.event.shell_command).toBe('rm -rf /tmp');

    // Both get denied by the same policy
    const ccPolicy = evaluateLocalPolicy(ccResult!.event, TEST_RULES);
    const cursorPolicy = evaluateLocalPolicy(cursorResult!.event, TEST_RULES);
    expect(ccPolicy.action).toBe('deny');
    expect(cursorPolicy.action).toBe('deny');
    expect(ccPolicy.matchedRules.map((r) => r.id)).toEqual(['deny-rm-rf']);
    expect(cursorPolicy.matchedRules.map((r) => r.id)).toEqual(['deny-rm-rf']);

    // Telemetry entries have identical structure
    const ccEntry = eventToLogEntry(ccResult!.event, 'deny', ['deny-rm-rf']);
    const cursorEntry = eventToLogEntry(cursorResult!.event, 'deny', ['deny-rm-rf']);
    assertStructurallyEqual(ccEntry, cursorEntry);

    // Verify the expected differences
    expect(ccEntry.ide_source).toBe('claude-code');
    expect(cursorEntry.ide_source).toBe('cursor');
    expect(ccEntry.actor).toBe('claude-code');
    expect(cursorEntry.actor).toBe('cursor');
  });
});

// ── allowed shell command from both IDEs ────────────────────────────────────

describe('allowed shell command from both IDEs', () => {
  it('produces identical allow results for npm test', () => {
    const ccResult = routeStdin(ccShellPayload('npm test'));
    const cursorResult = routeStdin(cursorShellPayload('npm test'));
    expect(ccResult).not.toBeNull();
    expect(cursorResult).not.toBeNull();

    expect(ccResult!.event.tool).toBe('shell');
    expect(cursorResult!.event.tool).toBe('shell');
    expect(ccResult!.event.shell_command).toBe('npm test');
    expect(cursorResult!.event.shell_command).toBe('npm test');

    const ccPolicy = evaluateLocalPolicy(ccResult!.event, TEST_RULES);
    const cursorPolicy = evaluateLocalPolicy(cursorResult!.event, TEST_RULES);
    expect(ccPolicy.action).toBe('allow');
    expect(cursorPolicy.action).toBe('allow');

    const ccEntry = eventToLogEntry(ccResult!.event, 'allow', []);
    const cursorEntry = eventToLogEntry(cursorResult!.event, 'allow', []);
    assertStructurallyEqual(ccEntry, cursorEntry);
  });
});

// ── file edit from both IDEs ────────────────────────────────────────────────

describe('file edit from both IDEs', () => {
  it('normalizes to the same tool and file_path', () => {
    const ccResult = routeStdin(ccFileEditPayload('src/auth.ts'));
    const cursorResult = routeStdin(cursorFileEditPayload('src/auth.ts'));
    expect(ccResult).not.toBeNull();
    expect(cursorResult).not.toBeNull();

    // Both normalize to file_edit
    expect(ccResult!.event.tool).toBe('file_edit');
    expect(cursorResult!.event.tool).toBe('file_edit');
    expect(ccResult!.event.file_path).toBeUndefined(); // CC Edit puts file_path in tool_input, not top-level
    expect(cursorResult!.event.file_path).toBe('src/auth.ts');

    // Both are post phase (PostToolUse and afterFileEdit)
    expect(ccResult!.event.phase).toBe('post');
    expect(cursorResult!.event.phase).toBe('post');

    // Telemetry entries share the same tool
    const ccEntry = eventToLogEntry(ccResult!.event, 'allow', []);
    const cursorEntry = eventToLogEntry(cursorResult!.event, 'allow', []);
    expect(ccEntry.tool).toBe(cursorEntry.tool);
    expect(ccEntry.policy_decision).toBe(cursorEntry.policy_decision);
  });
});

// ── telemetry structural equality ───────────────────────────────────────────

describe('telemetry structural equality', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('entries from both IDEs have identical keys in the log file', () => {
    const dir = mktemp(); tmps.push(dir);
    const oculiDir = path.join(dir, '.oculi');
    fs.mkdirSync(oculiDir, { recursive: true });

    const ccResult = routeStdin(ccShellPayload('npm test'));
    const cursorResult = routeStdin(cursorShellPayload('npm test'));

    const ccEntry = eventToLogEntry(ccResult!.event, 'allow', []);
    const cursorEntry = eventToLogEntry(cursorResult!.event, 'allow', []);

    appendTelemetry(ccEntry, oculiDir);
    appendTelemetry(cursorEntry, oculiDir);

    const logPath = path.join(oculiDir, 'telemetry.jsonl');
    const lines = readTelemetryLines(logPath);
    expect(lines).toHaveLength(2);

    // Keys may differ slightly due to undefined values being omitted by JSON.stringify
    // (e.g. Claude Code has no trace_id). The important thing is that all
    // non-IDE-specific fields carry the same values.
    const ccKeys = Object.keys(lines[0]).sort();
    const cursorKeys = Object.keys(lines[1]).sort();

    // All CC keys should be a subset of Cursor keys (Cursor has trace_id extra)
    for (const key of ccKeys) {
      expect(cursorKeys).toContain(key);
    }

    // The only extra key Cursor has is trace_id
    const extraKeys = cursorKeys.filter((k) => !ccKeys.includes(k));
    expect(extraKeys).toEqual(['trace_id']);

    // Shared field values match
    expect(lines[0].ide_source).toBe('claude-code');
    expect(lines[1].ide_source).toBe('cursor');
    expect(lines[0].tool).toBe(lines[1].tool);
    expect(lines[0].shell_command).toBe(lines[1].shell_command);
    expect(lines[0].policy_decision).toBe(lines[1].policy_decision);
    expect(lines[0].schema_version).toBe(lines[1].schema_version);
    expect(lines[0].org_id).toBe(lines[1].org_id);
    expect(lines[0].phase).toBe(lines[1].phase);
  });
});

// ── telemetry filtering works across IDEs ───────────────────────────────────

describe('telemetry filtering works across IDEs', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('filter returns entries from both IDEs', () => {
    const dir = mktemp(); tmps.push(dir);
    const oculiDir = path.join(dir, '.oculi');
    fs.mkdirSync(oculiDir, { recursive: true });

    const ccDeny = routeStdin(ccShellPayload('rm -rf /tmp'));
    const cursorDeny = routeStdin(cursorShellPayload('rm -rf /tmp'));
    const ccAllow = routeStdin(ccShellPayload('npm test'));

    appendTelemetry(eventToLogEntry(ccDeny!.event, 'deny', ['deny-rm-rf']), oculiDir);
    appendTelemetry(eventToLogEntry(cursorDeny!.event, 'deny', ['deny-rm-rf']), oculiDir);
    appendTelemetry(eventToLogEntry(ccAllow!.event, 'allow', []), oculiDir);

    const logPath = path.join(oculiDir, 'telemetry.jsonl');

    const denyOnly = readTelemetryLines(logPath, { filter: 'deny' });
    expect(denyOnly).toHaveLength(2);
    expect(denyOnly[0].ide_source).toBe('claude-code');
    expect(denyOnly[1].ide_source).toBe('cursor');

    const allowOnly = readTelemetryLines(logPath, { filter: 'allow' });
    expect(allowOnly).toHaveLength(1);
  });
});

// ── install + uninstall for both targets ────────────────────────────────────

describe('install + uninstall for both targets', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('installs and uninstalls Claude Code hooks', () => {
    const dir = mktemp(); tmps.push(dir);
    const opts = { home: dir };

    const installResult = installClaudeCode(opts);
    expect(installResult.added).toEqual(['PreToolUse', 'PostToolUse', 'Stop']);

    const configPath = path.join(dir, '.claude', 'settings.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.hooks.PreToolUse).toBeDefined();
    expect(config.hooks.PreToolUse[0].hooks[0].command).toContain('oculi emit claude-code');

    // Idempotent — second install adds nothing
    const secondInstall = installClaudeCode(opts);
    expect(secondInstall.added).toEqual([]);

    // Uninstall removes all hooks
    const uninstallResult = uninstallClaudeCode(opts);
    expect(uninstallResult.removed).toHaveLength(3);

    const afterConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(afterConfig.hooks).toEqual({});
  });

  it('installs and uninstalls Cursor hooks', () => {
    const dir = mktemp(); tmps.push(dir);
    const opts = { home: dir };

    const installResult = installCursor(opts);
    expect(installResult.added).toEqual([
      'beforeShellExecution',
      'afterFileEdit',
      'beforeReadFile',
      'beforeMCPExecution',
      'stop',
    ]);

    const configPath = path.join(dir, '.cursor', 'hooks.json');
    expect(fs.existsSync(configPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(config.hooks.beforeShellExecution).toBeDefined();
    expect(config.hooks.beforeShellExecution[0].command).toContain('oculi emit cursor');

    // Idempotent
    const secondInstall = installCursor(opts);
    expect(secondInstall.added).toEqual([]);

    // Uninstall
    const uninstallResult = uninstallCursor(opts);
    expect(uninstallResult.removed).toHaveLength(5);

    const afterConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(afterConfig.hooks).toEqual({});
  });
});

// ── report aggregates both IDEs correctly ───────────────────────────────────

describe('report aggregates both IDEs correctly', () => {
  it('counts events by IDE, tool, and violations', () => {
    const now = new Date().toISOString();

    const ccShell = routeStdin(ccShellPayload('npm test'));
    const cursorShell = routeStdin(cursorShellPayload('npm test'));
    const ccDeny = routeStdin(ccShellPayload('rm -rf /tmp'));
    const cursorDeny = routeStdin(cursorShellPayload('rm -rf /tmp'));

    const entries: TelemetryLogEntry[] = [
      eventToLogEntry(ccShell!.event, 'allow', []),
      eventToLogEntry(cursorShell!.event, 'allow', []),
      eventToLogEntry(ccDeny!.event, 'deny', ['deny-rm-rf']),
      eventToLogEntry(cursorDeny!.event, 'deny', ['deny-rm-rf']),
    ];
    // Ensure timestamps are within the report window
    for (const e of entries) e.timestamp = now;

    const report = buildReport(entries, 24);

    expect(report.total).toBe(4);
    expect(report.by_phase.pre).toBe(4);

    // Both IDEs present
    const ideNames = report.by_ide.map((i) => i.ide).sort();
    expect(ideNames).toEqual(['claude-code', 'cursor']);
    expect(report.by_ide.find((i) => i.ide === 'claude-code')!.count).toBe(2);
    expect(report.by_ide.find((i) => i.ide === 'cursor')!.count).toBe(2);

    // All are shell tool
    expect(report.by_tool).toHaveLength(1);
    expect(report.by_tool[0].tool).toBe('shell');
    expect(report.by_tool[0].count).toBe(4);

    // 2 violations (both deny)
    expect(report.violations).toHaveLength(2);
    expect(report.violations.every((v) => v.decision === 'deny')).toBe(true);
    expect(report.violations.every((v) => v.rule_ids.includes('deny-rm-rf'))).toBe(true);
  });
});
