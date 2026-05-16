import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runInit } from '../../src/commands/init';
import { runUninstall } from '../../src/commands/uninstall';

function mktemp(prefix = 'oculi-uninst-test-'): string {
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

describe('runUninstall (orchestrator)', () => {
  const tmps: string[] = [];
  afterEach(() => {
    cleanup(tmps);
    tmps.length = 0;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('removes everything when both agents wired and policy existed', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude', 'cursor']); tmps.push(binDir);
    silenceOutput();

    runInit({ home: cwd });
    const r = runUninstall({ home: cwd });

    expect(r.exitCode).toBe(0);
    expect(r.policyRemoved).toBe(true);
    expect(r.remainingAgents).toEqual([]);
    expect(fs.existsSync(path.join(cwd, '.oculi', 'policy.yaml'))).toBe(false);

    const cc = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8'));
    expect(cc.hooks).toEqual({});
    const cur = JSON.parse(fs.readFileSync(path.join(cwd, '.cursor', 'hooks.json'), 'utf8'));
    expect(cur.hooks).toEqual({});
  });

  it('is a gentle no-op on a fresh project', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith([]); tmps.push(binDir);
    const { stdout } = silenceOutput();

    const r = runUninstall({ home: cwd });
    expect(r.exitCode).toBe(0);
    expect(r.policyRemoved).toBe(false);
    expect(stdout.join('')).toContain('Nothing to remove');
    expect(fs.existsSync(path.join(cwd, '.oculi'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(cwd, '.cursor'))).toBe(false);
  });

  it('--agent cursor leaves claude-code alone and preserves policy', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude', 'cursor']); tmps.push(binDir);
    silenceOutput();

    runInit({ home: cwd });
    const r = runUninstall({ home: cwd, agent: 'cursor' });

    expect(r.policyRemoved).toBe(false);
    expect(r.remainingAgents).toEqual(['claude-code']);
    expect(fs.existsSync(path.join(cwd, '.oculi', 'policy.yaml'))).toBe(true);

    const cc = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8'));
    expect(cc.hooks.PreToolUse).toBeDefined();

    const cur = JSON.parse(fs.readFileSync(path.join(cwd, '.cursor', 'hooks.json'), 'utf8'));
    expect(cur.hooks).toEqual({});
  });

  it('--agent X removes policy when no other agents remain wired', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude']); tmps.push(binDir);
    silenceOutput();

    runInit({ home: cwd });
    const r = runUninstall({ home: cwd, agent: 'claude-code' });

    expect(r.policyRemoved).toBe(true);
    expect(r.remainingAgents).toEqual([]);
    expect(fs.existsSync(path.join(cwd, '.oculi', 'policy.yaml'))).toBe(false);
  });

  it('safety: complex non-oculi state in settings.json is preserved byte-identical (claude-code)', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['claude']); tmps.push(binDir);
    silenceOutput();

    const ccPath = path.join(cwd, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(ccPath), { recursive: true });
    const original = {
      env: { FOO: 'bar', NESTED: { x: 1 } },
      permissions: { allow: ['Read', 'Write'] },
      model: 'claude-sonnet-4-6',
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'my-guard' }] },
          { matcher: 'Edit', hooks: [{ type: 'command', command: 'my-formatter' }] },
        ],
        PostToolUse: [
          { matcher: '', hooks: [{ type: 'command', command: 'my-logger' }] },
        ],
      },
    };
    const originalBytes = JSON.stringify(original, null, 2) + '\n';
    fs.writeFileSync(ccPath, originalBytes, 'utf8');

    runInit({ home: cwd, agent: 'claude-code' });
    runUninstall({ home: cwd, agent: 'claude-code' });

    const after = fs.readFileSync(ccPath, 'utf8');
    expect(after).toBe(originalBytes);
  });

  it('safety: complex non-oculi state in cursor hooks.json is preserved byte-identical', () => {
    const cwd = mktemp(); tmps.push(cwd);
    const binDir = stubPathWith(['cursor']); tmps.push(binDir);
    silenceOutput();

    const curPath = path.join(cwd, '.cursor', 'hooks.json');
    fs.mkdirSync(path.dirname(curPath), { recursive: true });
    const original = {
      version: 1,
      hooks: {
        beforeShellExecution: [{ command: 'my-linter' }, { command: 'my-other-check' }],
        afterFileEdit: [{ command: 'my-formatter' }],
      },
    };
    const originalBytes = JSON.stringify(original, null, 2) + '\n';
    fs.writeFileSync(curPath, originalBytes, 'utf8');

    runInit({ home: cwd, agent: 'cursor' });
    runUninstall({ home: cwd, agent: 'cursor' });

    const after = fs.readFileSync(curPath, 'utf8');
    expect(after).toBe(originalBytes);
  });
});
