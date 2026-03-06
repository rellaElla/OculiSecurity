import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { installCursor, uninstallCursor } from '../../src/install/cursor';
import { installClaudeCode, uninstallClaudeCode } from '../../src/install/claude-code';

// ── helpers ──────────────────────────────────────────────────────────────────

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oculi-test-'));
}

function cleanup(dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

// ── Cursor ────────────────────────────────────────────────────────────────────

describe('installCursor', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('creates the file when it does not exist', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const result = installCursor({ global: false, dryRun: false, cwd });
    expect(result.added).toEqual([
      'beforeShellExecution', 'afterFileEdit', 'beforeReadFile', 'beforeMCPExecution', 'stop',
    ]);
    const config = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(config.version).toBe(1);
    expect(config.hooks.beforeShellExecution[0].command).toBe('oculi emit cursor beforeShellExecution');
    expect(config.hooks.stop[0].command).toBe('oculi emit cursor stop');
  });

  it('merges when file already has unrelated hooks', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const hookPath = path.join(cwd, '.cursor', 'hooks.json');
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, JSON.stringify({
      version: 1,
      hooks: { beforeShellExecution: [{ command: 'my-linter' }] },
    }), 'utf8');

    const result = installCursor({ global: false, dryRun: false, cwd });
    // beforeShellExecution already has an entry, Oculi adds another
    expect(result.added).toContain('beforeShellExecution');
    const config = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(config.hooks.beforeShellExecution).toHaveLength(2);
    expect(config.hooks.beforeShellExecution[0].command).toBe('my-linter');
    expect(config.hooks.beforeShellExecution[1].command).toBe('oculi emit cursor beforeShellExecution');
  });

  it('is idempotent — second call adds nothing', () => {
    const cwd = mktemp(); tmps.push(cwd);
    installCursor({ global: false, dryRun: false, cwd });
    const result = installCursor({ global: false, dryRun: false, cwd });
    expect(result.added).toHaveLength(0);
  });

  it('dry-run returns added list without writing', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const result = installCursor({ global: false, dryRun: true, cwd });
    expect(result.added).toHaveLength(5);
    expect(fs.existsSync(result.path)).toBe(false);
  });
});

describe('uninstallCursor', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('removes Oculi entries, leaves others', () => {
    const cwd = mktemp(); tmps.push(cwd);
    installCursor({ global: false, dryRun: false, cwd });

    // Add a non-Oculi entry alongside the Oculi one
    const hookPath = path.join(cwd, '.cursor', 'hooks.json');
    const config = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
    config.hooks.beforeShellExecution.unshift({ command: 'my-linter' });
    fs.writeFileSync(hookPath, JSON.stringify(config, null, 2), 'utf8');

    const result = uninstallCursor({ global: false, dryRun: false, cwd });
    expect(result.removed.length).toBeGreaterThan(0);
    const updated = JSON.parse(fs.readFileSync(hookPath, 'utf8'));
    // my-linter entry should remain
    expect(updated.hooks.beforeShellExecution).toHaveLength(1);
    expect(updated.hooks.beforeShellExecution[0].command).toBe('my-linter');
  });

  it('is a no-op when nothing installed', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const result = uninstallCursor({ global: false, dryRun: false, cwd });
    expect(result.removed).toHaveLength(0);
  });

  it('dry-run returns removed list without modifying file', () => {
    const cwd = mktemp(); tmps.push(cwd);
    installCursor({ global: false, dryRun: false, cwd });
    const hookPath = path.join(cwd, '.cursor', 'hooks.json');
    const before = fs.readFileSync(hookPath, 'utf8');

    const result = uninstallCursor({ global: false, dryRun: true, cwd });
    expect(result.removed.length).toBeGreaterThan(0);
    expect(fs.readFileSync(hookPath, 'utf8')).toBe(before);
  });
});

// ── Claude Code ───────────────────────────────────────────────────────────────

describe('installClaudeCode', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('creates the file when it does not exist', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const result = installClaudeCode({ global: false, dryRun: false, cwd });
    expect(result.added).toEqual(['PreToolUse', 'PostToolUse', 'Stop']);
    const settings = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    const preHook = settings.hooks.PreToolUse[0];
    expect(preHook.matcher).toBe('');
    expect(preHook.hooks[0].command).toBe('oculi emit claude-code PreToolUse');
  });

  it('merges when file already has unrelated hooks', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const configPath = path.join(cwd, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard' }] }],
      },
    }), 'utf8');

    const result = installClaudeCode({ global: false, dryRun: false, cwd });
    expect(result.added).toContain('PreToolUse');
    const settings = JSON.parse(fs.readFileSync(result.path, 'utf8'));
    expect(settings.hooks.PreToolUse).toHaveLength(2);
    expect(settings.hooks.PreToolUse[0].hooks[0].command).toBe('my-guard');
    expect(settings.hooks.PreToolUse[1].hooks[0].command).toBe('oculi emit claude-code PreToolUse');
  });

  it('is idempotent — second call adds nothing', () => {
    const cwd = mktemp(); tmps.push(cwd);
    installClaudeCode({ global: false, dryRun: false, cwd });
    const result = installClaudeCode({ global: false, dryRun: false, cwd });
    expect(result.added).toHaveLength(0);
  });

  it('dry-run returns added list without writing', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const result = installClaudeCode({ global: false, dryRun: true, cwd });
    expect(result.added).toHaveLength(3);
    expect(fs.existsSync(result.path)).toBe(false);
  });
});

describe('uninstallClaudeCode', () => {
  const tmps: string[] = [];
  afterEach(() => { cleanup(tmps); tmps.length = 0; });

  it('removes Oculi entries, leaves others', () => {
    const cwd = mktemp(); tmps.push(cwd);
    installClaudeCode({ global: false, dryRun: false, cwd });

    // Add a non-Oculi entry alongside Oculi
    const configPath = path.join(cwd, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    settings.hooks.PreToolUse.unshift({ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard' }] });
    fs.writeFileSync(configPath, JSON.stringify(settings, null, 2), 'utf8');

    const result = uninstallClaudeCode({ global: false, dryRun: false, cwd });
    expect(result.removed.length).toBeGreaterThan(0);
    const updated = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(updated.hooks.PreToolUse).toHaveLength(1);
    expect(updated.hooks.PreToolUse[0].hooks[0].command).toBe('my-guard');
  });

  it('is a no-op when nothing installed', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const result = uninstallClaudeCode({ global: false, dryRun: false, cwd });
    expect(result.removed).toHaveLength(0);
  });

  it('dry-run returns removed list without modifying file', () => {
    const cwd = mktemp(); tmps.push(cwd);
    installClaudeCode({ global: false, dryRun: false, cwd });
    const configPath = path.join(cwd, '.claude', 'settings.json');
    const before = fs.readFileSync(configPath, 'utf8');

    const result = uninstallClaudeCode({ global: false, dryRun: true, cwd });
    expect(result.removed.length).toBeGreaterThan(0);
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('preserves non-hooks settings fields', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const configPath = path.join(cwd, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({ env: { FOO: 'bar' }, hooks: {} }), 'utf8');

    installClaudeCode({ global: false, dryRun: false, cwd });
    uninstallClaudeCode({ global: false, dryRun: false, cwd });
    const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    expect(settings.env).toEqual({ FOO: 'bar' });
  });
});
