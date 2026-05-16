import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInit } from '../../src/commands/init';

function mktemp(prefix = 'oculi-init-test-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

function fakeBin(dir: string, name: string): void {
  const file = path.join(dir, process.platform === 'win32' ? `${name}.cmd` : name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') fs.chmodSync(file, 0o755);
}

function stubPathWith(binaries: string[]): string {
  const dir = mktemp('oculi-bin-');
  for (const b of binaries) fakeBin(dir, b);
  vi.stubEnv('PATH', dir);
  return dir;
}

function silenceOutput(): { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => { stdout.push(String(chunk)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => { stderr.push(String(chunk)); return true; });
  return { stdout, stderr };
}

describe('runInit (orchestrator)', () => {
  const tmps: string[] = [];
  afterEach(() => {
    cleanup(tmps);
    tmps.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('writes policy + wires both agents when both detected', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude', 'cursor']); tmps.push(binDir);
    silenceOutput();

    const r = runInit({ home: cwd });
    expect(r.exitCode).toBe(0);
    expect(r.policyCreated).toBe(true);
    expect(r.wired).toEqual(['claude-code', 'cursor']);

    const policy = fs.readFileSync(path.join(cwd, '.oculi', 'policy.yaml'), 'utf8');
    expect(policy).toContain('no-rm-rf');

    const cc = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8'));
    expect(cc.hooks.PreToolUse[0].hooks[0].command).toContain('oculi emit claude-code');

    const cur = JSON.parse(fs.readFileSync(path.join(cwd, '.cursor', 'hooks.json'), 'utf8'));
    expect(cur.hooks.beforeShellExecution[0].command).toContain('oculi emit cursor');
  });

  it('wires only claude-code when only claude on PATH', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude']); tmps.push(binDir);
    silenceOutput();

    const r = runInit({ home: cwd });
    expect(r.exitCode).toBe(0);
    expect(r.wired).toEqual(['claude-code']);
    expect(fs.existsSync(path.join(cwd, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.cursor'))).toBe(false);
  });

  it('no agents detected: writes policy, warns, exits 0, no agent configs', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith([]); tmps.push(binDir);
    const { stdout, stderr } = silenceOutput();

    const r = runInit({ home: cwd });
    expect(r.exitCode).toBe(0);
    expect(r.wired).toEqual([]);
    expect(r.policyCreated).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.oculi', 'policy.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.cursor'))).toBe(false);
    expect(stdout.join('')).toContain('No supported agents detected on PATH');
    expect(stderr.join('')).toBe('');
  });

  it('is idempotent: second run does not duplicate hooks or clobber policy', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude', 'cursor']); tmps.push(binDir);
    silenceOutput();

    runInit({ home: cwd });
    const r = runInit({ home: cwd });

    expect(r.policyCreated).toBe(false);
    expect(r.added['claude-code']).toEqual([]);
    expect(r.added.cursor).toEqual([]);

    const cc = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8'));
    expect(cc.hooks.PreToolUse).toHaveLength(1);
    expect(cc.hooks.PostToolUse).toHaveLength(1);
    expect(cc.hooks.Stop).toHaveLength(1);
  });

  it('preserves existing user-authored hooks during init', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude', 'cursor']); tmps.push(binDir);
    silenceOutput();

    const ccPath = path.join(cwd, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(ccPath), { recursive: true });
    fs.writeFileSync(ccPath, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard' }] }],
      },
    }), 'utf8');
    const curPath = path.join(cwd, '.cursor', 'hooks.json');
    fs.mkdirSync(path.dirname(curPath), { recursive: true });
    fs.writeFileSync(curPath, JSON.stringify({
      version: 1,
      hooks: { beforeShellExecution: [{ command: 'my-linter' }] },
    }), 'utf8');

    runInit({ home: cwd });

    const cc = JSON.parse(fs.readFileSync(ccPath, 'utf8'));
    expect(cc.hooks.PreToolUse).toHaveLength(2);
    expect(cc.hooks.PreToolUse[0].hooks[0].command).toBe('my-guard');

    const cur = JSON.parse(fs.readFileSync(curPath, 'utf8'));
    expect(cur.hooks.beforeShellExecution).toHaveLength(2);
    expect(cur.hooks.beforeShellExecution[0].command).toBe('my-linter');
  });

  it('does NOT clobber existing policy.yaml', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude']); tmps.push(binDir);
    silenceOutput();

    const policyPath = path.join(cwd, '.oculi', 'policy.yaml');
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.writeFileSync(policyPath, '# custom\nrules: []\n', 'utf8');

    const r = runInit({ home: cwd });
    expect(r.policyCreated).toBe(false);
    expect(fs.readFileSync(policyPath, 'utf8')).toBe('# custom\nrules: []\n');
  });

  it('--agent claude-code restricts to claude-code only', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude', 'cursor']); tmps.push(binDir);
    silenceOutput();

    const r = runInit({ home: cwd, agent: 'claude-code' });
    expect(r.exitCode).toBe(0);
    expect(r.wired).toEqual(['claude-code']);
    expect(fs.existsSync(path.join(cwd, '.cursor'))).toBe(false);
  });

  it('--agent claude-code exits 1 when claude not detected', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith([]); tmps.push(binDir);
    const { stderr } = silenceOutput();

    const r = runInit({ home: cwd, agent: 'claude-code' });
    expect(r.exitCode).toBe(1);
    expect(r.policyCreated).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.oculi'))).toBe(false);
    expect(stderr.join('')).toContain("'claude-code' not found on PATH");
  });

  it('migration: pre-existing policy.yaml + .claude/settings.json from old flow is a clean no-op', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude']); tmps.push(binDir);
    silenceOutput();

    // Simulate state left by `oculi init standard` + `oculi install claude-code` on an older version.
    const policyPath = path.join(cwd, '.oculi', 'policy.yaml');
    fs.mkdirSync(path.dirname(policyPath), { recursive: true });
    fs.writeFileSync(policyPath, '# pre-existing\nrules: []\n', 'utf8');

    const ccPath = path.join(cwd, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(ccPath), { recursive: true });
    fs.writeFileSync(ccPath, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'oculi emit claude-code PreToolUse' }] }],
        PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'oculi emit claude-code PostToolUse' }] }],
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'oculi emit claude-code Stop' }] }],
      },
    }, null, 2) + '\n', 'utf8');

    const r = runInit({ home: cwd });
    expect(r.policyCreated).toBe(false);
    expect(r.added['claude-code']).toEqual([]);

    expect(fs.readFileSync(policyPath, 'utf8')).toBe('# pre-existing\nrules: []\n');

    const cc = JSON.parse(fs.readFileSync(ccPath, 'utf8'));
    expect(cc.hooks.PreToolUse).toHaveLength(1);
    expect(cc.hooks.PostToolUse).toHaveLength(1);
    expect(cc.hooks.Stop).toHaveLength(1);
  });
});
