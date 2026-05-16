import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { detectAgents, isAgentInstalled } from '../../src/install/detect';

function mktemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oculi-detect-test-'));
}

function cleanup(dirs: string[]): void {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
}

function fakeBin(dir: string, name: string): void {
  const file = path.join(dir, process.platform === 'win32' ? `${name}.cmd` : name);
  fs.writeFileSync(file, '#!/bin/sh\nexit 0\n');
  if (process.platform !== 'win32') {
    fs.chmodSync(file, 0o755);
  }
}

describe('detectAgents', () => {
  const tmps: string[] = [];
  afterEach(() => {
    cleanup(tmps);
    tmps.length = 0;
    vi.unstubAllEnvs();
  });

  it('detects claude-code when claude binary on PATH', () => {
    const dir = mktemp(); tmps.push(dir);
    fakeBin(dir, 'claude');
    vi.stubEnv('PATH', dir);
    expect(detectAgents()).toEqual(['claude-code']);
  });

  it('detects cursor when cursor binary on PATH', () => {
    const dir = mktemp(); tmps.push(dir);
    fakeBin(dir, 'cursor');
    vi.stubEnv('PATH', dir);
    expect(detectAgents()).toEqual(['cursor']);
  });

  it('detects both when both binaries on PATH', () => {
    const dir = mktemp(); tmps.push(dir);
    fakeBin(dir, 'claude');
    fakeBin(dir, 'cursor');
    vi.stubEnv('PATH', dir);
    expect(detectAgents()).toEqual(['claude-code', 'cursor']);
  });

  it('returns empty when PATH has neither binary', () => {
    const dir = mktemp(); tmps.push(dir);
    vi.stubEnv('PATH', dir);
    expect(detectAgents()).toEqual([]);
  });

  it('returns empty when PATH env is empty', () => {
    vi.stubEnv('PATH', '');
    expect(detectAgents()).toEqual([]);
  });

  it('searches across multiple PATH entries', () => {
    const a = mktemp(); tmps.push(a);
    const b = mktemp(); tmps.push(b);
    fakeBin(a, 'cursor');
    fakeBin(b, 'claude');
    const sep = process.platform === 'win32' ? ';' : ':';
    vi.stubEnv('PATH', `${a}${sep}${b}`);
    expect(detectAgents()).toEqual(['claude-code', 'cursor']);
  });
});

describe('isAgentInstalled', () => {
  const tmps: string[] = [];
  afterEach(() => {
    cleanup(tmps);
    tmps.length = 0;
    vi.unstubAllEnvs();
  });

  it('returns true when binary present, false when absent', () => {
    const dir = mktemp(); tmps.push(dir);
    fakeBin(dir, 'claude');
    vi.stubEnv('PATH', dir);
    expect(isAgentInstalled('claude-code')).toBe(true);
    expect(isAgentInstalled('cursor')).toBe(false);
  });
});
