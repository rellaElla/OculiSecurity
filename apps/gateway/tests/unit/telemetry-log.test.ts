import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  appendTelemetry,
  eventToLogEntry,
  readTelemetryLines,
  findTelemetryLog,
  findOrCreateOculiDir,
  TelemetryLogEntry,
} from '../../src/services/telemetry-log';
import { OculiEvent } from '../../src/routes/adapters/schema';
import { formatEntry } from '../../src/commands/tail';
import { buildReport } from '../../src/commands/report';

// ── helpers ──────────────────────────────────────────────────────────────────

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oculi-telemetry-test-'));
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
    tool: 'shell',
    shell_command: 'npm test',
    action: { command: 'npm test' },
    timestamp: new Date().toISOString(),
    raw_payload: { some: 'data', nested: { deep: true } },
    ...overrides,
  };
}

function makeEntry(overrides: Partial<TelemetryLogEntry> = {}): TelemetryLogEntry {
  return {
    schema_version: '1',
    ide_source: 'claude-code',
    actor: 'claude-code',
    org_id: 'default',
    hook_event_name: 'PreToolUse',
    phase: 'pre',
    session_id: 'test-session',
    tool: 'shell',
    shell_command: 'npm test',
    action: { command: 'npm test' },
    timestamp: new Date().toISOString(),
    policy_decision: 'allow',
    policy_rule_ids: [],
    ...overrides,
  };
}

// ── eventToLogEntry ─────────────────────────────────────────────────────────

describe('eventToLogEntry', () => {
  it('omits raw_payload from the log entry', () => {
    const event = makeEvent({ raw_payload: { secret: 'should-not-appear' } });
    const entry = eventToLogEntry(event, 'allow', []);
    expect(entry).not.toHaveProperty('raw_payload');
    expect(entry.policy_decision).toBe('allow');
  });

  it('preserves policy decision and rule ids', () => {
    const event = makeEvent();
    const entry = eventToLogEntry(event, 'deny', ['no-rm-rf', 'block-all']);
    expect(entry.policy_decision).toBe('deny');
    expect(entry.policy_rule_ids).toEqual(['no-rm-rf', 'block-all']);
  });

  it('produces identical structure for Claude Code and Cursor events', () => {
    const ccEvent = makeEvent({ ide_source: 'claude-code', actor: 'claude-code' });
    const cursorEvent = makeEvent({ ide_source: 'cursor', actor: 'cursor' });

    const ccEntry = eventToLogEntry(ccEvent, 'allow');
    const cursorEntry = eventToLogEntry(cursorEvent, 'allow');

    // Same keys
    const ccKeys = Object.keys(ccEntry).sort();
    const cursorKeys = Object.keys(cursorEntry).sort();
    expect(ccKeys).toEqual(cursorKeys);

    // Only ide_source and actor differ
    expect(ccEntry.ide_source).toBe('claude-code');
    expect(cursorEntry.ide_source).toBe('cursor');
    expect(ccEntry.actor).toBe('claude-code');
    expect(cursorEntry.actor).toBe('cursor');
  });
});

// ── appendTelemetry ─────────────────────────────────────────────────────────

describe('appendTelemetry', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('writes valid JSONL', () => {
    const dir = mktemp(); tmps.push(dir);
    const oculiDir = path.join(dir, '.oculi');
    fs.mkdirSync(oculiDir, { recursive: true });

    const entry = makeEntry();
    appendTelemetry(entry, oculiDir);
    appendTelemetry(makeEntry({ tool: 'file_read' }), oculiDir);

    const logPath = path.join(oculiDir, 'telemetry.jsonl');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);

    const parsed1 = JSON.parse(lines[0]) as TelemetryLogEntry;
    expect(parsed1.tool).toBe('shell');
    expect(parsed1.policy_decision).toBe('allow');

    const parsed2 = JSON.parse(lines[1]) as TelemetryLogEntry;
    expect(parsed2.tool).toBe('file_read');
  });

  it('rotates file at 10MB', () => {
    const dir = mktemp(); tmps.push(dir);
    const oculiDir = path.join(dir, '.oculi');
    fs.mkdirSync(oculiDir, { recursive: true });

    const logPath = path.join(oculiDir, 'telemetry.jsonl');
    // Write a 10MB+ file
    const bigLine = JSON.stringify(makeEntry({ shell_command: 'x'.repeat(1000) })) + '\n';
    const lines = Math.ceil((10 * 1024 * 1024) / bigLine.length) + 1;
    const fd = fs.openSync(logPath, 'w');
    for (let i = 0; i < lines; i++) {
      fs.writeSync(fd, bigLine);
    }
    fs.closeSync(fd);

    // Now append should trigger rotation
    appendTelemetry(makeEntry({ tool: 'after-rotation' }), oculiDir);

    // The rotated file should exist
    expect(fs.existsSync(path.join(oculiDir, 'telemetry.1.jsonl'))).toBe(true);

    // The new file should have only the new entry
    const newContent = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(newContent).toHaveLength(1);
    const parsed = JSON.parse(newContent[0]) as TelemetryLogEntry;
    expect(parsed.tool).toBe('after-rotation');
  });
});

// ── readTelemetryLines ──────────────────────────────────────────────────────

describe('readTelemetryLines', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('reads and parses JSONL', () => {
    const dir = mktemp(); tmps.push(dir);
    const logPath = path.join(dir, 'telemetry.jsonl');
    const entries = [
      makeEntry({ tool: 'shell' }),
      makeEntry({ tool: 'file_read' }),
      makeEntry({ tool: 'mcp_call', policy_decision: 'deny', policy_rule_ids: ['block-mcp'] }),
    ];
    fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    const result = readTelemetryLines(logPath);
    expect(result).toHaveLength(3);
    expect(result[2].policy_decision).toBe('deny');
  });

  it('filters by decision', () => {
    const dir = mktemp(); tmps.push(dir);
    const logPath = path.join(dir, 'telemetry.jsonl');
    const entries = [
      makeEntry({ policy_decision: 'allow' }),
      makeEntry({ policy_decision: 'deny' }),
      makeEntry({ policy_decision: 'warn' }),
      makeEntry({ policy_decision: 'deny' }),
    ];
    fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    const denied = readTelemetryLines(logPath, { filter: 'deny' });
    expect(denied).toHaveLength(2);
  });

  it('filters by time', () => {
    const dir = mktemp(); tmps.push(dir);
    const logPath = path.join(dir, 'telemetry.jsonl');

    const old = new Date(Date.now() - 48 * 3600_000).toISOString();
    const recent = new Date().toISOString();
    const entries = [
      makeEntry({ timestamp: old, tool: 'old' }),
      makeEntry({ timestamp: recent, tool: 'recent' }),
    ];
    fs.writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');

    const since = new Date(Date.now() - 24 * 3600_000);
    const result = readTelemetryLines(logPath, { since });
    expect(result).toHaveLength(1);
    expect(result[0].tool).toBe('recent');
  });

  it('returns empty for nonexistent file', () => {
    const result = readTelemetryLines('/nonexistent/path.jsonl');
    expect(result).toEqual([]);
  });

  it('skips malformed lines', () => {
    const dir = mktemp(); tmps.push(dir);
    const logPath = path.join(dir, 'telemetry.jsonl');
    fs.writeFileSync(logPath, 'not-json\n{"bad":true\n' + JSON.stringify(makeEntry()) + '\n', 'utf8');

    const result = readTelemetryLines(logPath);
    expect(result).toHaveLength(1);
  });
});

// ── findTelemetryLog ────────────────────────────────────────────────────────

describe('findTelemetryLog', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('finds telemetry.jsonl in .oculi/ directory', () => {
    const dir = mktemp(); tmps.push(dir);
    const oculiDir = path.join(dir, '.oculi');
    fs.mkdirSync(oculiDir, { recursive: true });
    fs.writeFileSync(path.join(oculiDir, 'telemetry.jsonl'), '', 'utf8');

    const result = findTelemetryLog(dir);
    expect(result).toBe(path.join(oculiDir, 'telemetry.jsonl'));
  });

  it('walks up parent directories', () => {
    const root = mktemp(); tmps.push(root);
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });

    const oculiDir = path.join(root, '.oculi');
    fs.mkdirSync(oculiDir, { recursive: true });
    fs.writeFileSync(path.join(oculiDir, 'telemetry.jsonl'), '', 'utf8');

    const result = findTelemetryLog(nested);
    expect(result).toBe(path.join(oculiDir, 'telemetry.jsonl'));
  });
});

// ── findOrCreateOculiDir ────────────────────────────────────────────────────

describe('findOrCreateOculiDir', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('creates .oculi/ if none exists', () => {
    const dir = mktemp(); tmps.push(dir);
    const result = findOrCreateOculiDir(dir);
    expect(result).toBe(path.join(dir, '.oculi'));
    expect(fs.existsSync(result)).toBe(true);
  });

  it('finds existing .oculi/ in parent', () => {
    const root = mktemp(); tmps.push(root);
    const oculiDir = path.join(root, '.oculi');
    fs.mkdirSync(oculiDir, { recursive: true });
    const nested = path.join(root, 'a', 'b');
    fs.mkdirSync(nested, { recursive: true });

    const result = findOrCreateOculiDir(nested);
    expect(result).toBe(oculiDir);
  });
});

// ── formatEntry (tail) ──────────────────────────────────────────────────────

describe('formatEntry', () => {
  it('formats allow entry', () => {
    const entry = makeEntry({
      timestamp: '2026-03-05T14:32:01.000Z',
      tool: 'shell',
      action: { command: 'npm test' },
      policy_decision: 'allow',
    });
    const line = formatEntry(entry, false);
    expect(line).toContain('PRE');
    expect(line).toContain('shell');
    expect(line).toContain('npm test');
    expect(line).toContain('allow');
  });

  it('formats deny entry with rule ids', () => {
    const entry = makeEntry({
      timestamp: '2026-03-05T14:32:05.000Z',
      tool: 'shell',
      action: { command: 'rm -rf /' },
      policy_decision: 'deny',
      policy_rule_ids: ['no-rm-rf'],
    });
    const line = formatEntry(entry, false);
    expect(line).toContain('deny');
    expect(line).toContain('no-rm-rf');
    expect(line).toContain('rm -rf /');
  });

  it('formats warn entry', () => {
    const entry = makeEntry({
      tool: 'file_read',
      file_path: '.env.local',
      shell_command: undefined,
      action: undefined,
      policy_decision: 'warn',
      policy_rule_ids: ['warn-env'],
    });
    const line = formatEntry(entry, false);
    expect(line).toContain('warn');
    expect(line).toContain('.env.local');
    expect(line).toContain('warn-env');
  });

  it('shows file_path for file ops', () => {
    const entry = makeEntry({
      tool: 'file_edit',
      file_path: 'src/auth.ts',
      action: undefined,
      shell_command: undefined,
    });
    const line = formatEntry(entry, false);
    expect(line).toContain('src/auth.ts');
  });

  it('shows mcp_server for mcp events', () => {
    const entry = makeEntry({
      tool: 'mcp_call',
      mcp_server: 'risky-server',
      action: undefined,
      shell_command: undefined,
    });
    const line = formatEntry(entry, false);
    expect(line).toContain('risky-server');
  });

  it('formats post phase', () => {
    const entry = makeEntry({ phase: 'post' });
    const line = formatEntry(entry, false);
    expect(line).toContain('POST');
  });

  it('formats complete phase', () => {
    const entry = makeEntry({ phase: 'complete' });
    const line = formatEntry(entry, false);
    expect(line).toContain('DONE');
  });
});

// ── buildReport ─────────────────────────────────────────────────────────────

describe('buildReport', () => {
  it('counts events by phase, tool, and IDE', () => {
    const now = new Date();
    const entries: TelemetryLogEntry[] = [
      makeEntry({ phase: 'pre', tool: 'shell', ide_source: 'claude-code', timestamp: now.toISOString() }),
      makeEntry({ phase: 'pre', tool: 'shell', ide_source: 'cursor', timestamp: now.toISOString() }),
      makeEntry({ phase: 'post', tool: 'file_edit', ide_source: 'claude-code', timestamp: now.toISOString() }),
      makeEntry({ phase: 'pre', tool: 'file_read', ide_source: 'cursor', timestamp: now.toISOString() }),
    ];

    const report = buildReport(entries, 24);
    expect(report.total).toBe(4);
    expect(report.by_phase.pre).toBe(3);
    expect(report.by_phase.post).toBe(1);
    expect(report.by_tool[0].tool).toBe('shell');
    expect(report.by_tool[0].count).toBe(2);
    expect(report.by_ide).toHaveLength(2);
  });

  it('collects policy violations', () => {
    const now = new Date();
    const entries: TelemetryLogEntry[] = [
      makeEntry({ policy_decision: 'allow', timestamp: now.toISOString() }),
      makeEntry({ policy_decision: 'deny', policy_rule_ids: ['no-rm-rf'], tool: 'shell', action: { command: 'rm -rf /' }, timestamp: now.toISOString() }),
      makeEntry({ policy_decision: 'warn', policy_rule_ids: ['warn-env'], tool: 'file_read', file_path: '.env', timestamp: now.toISOString() }),
    ];

    const report = buildReport(entries, 24);
    expect(report.violations).toHaveLength(2);
    expect(report.violations[0].decision).toBe('deny');
    expect(report.violations[0].rule_ids).toEqual(['no-rm-rf']);
    expect(report.violations[1].decision).toBe('warn');
  });

  it('handles empty input', () => {
    const report = buildReport([], 24);
    expect(report.total).toBe(0);
    expect(report.by_tool).toEqual([]);
    expect(report.by_ide).toEqual([]);
    expect(report.violations).toEqual([]);
  });
});
