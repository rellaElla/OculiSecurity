import * as fs from 'fs';
import * as path from 'path';

export const AGENTS = ['claude-code', 'cursor'] as const;
export type Agent = (typeof AGENTS)[number];

export const BINARIES: Record<Agent, string> = {
  'claude-code': 'claude',
  cursor: 'cursor',
};

const WIN_EXTS = ['.exe', '.cmd', '.bat'];

function pathEntries(): string[] {
  const sep = process.platform === 'win32' ? ';' : ':';
  return (process.env.PATH ?? '').split(sep).filter(Boolean);
}

function existsInDir(dir: string, bin: string): boolean {
  if (process.platform === 'win32') {
    if (WIN_EXTS.some((e) => fs.existsSync(path.join(dir, bin + e)))) return true;
  }
  return fs.existsSync(path.join(dir, bin));
}

export function isAgentInstalled(agent: Agent): boolean {
  const bin = BINARIES[agent];
  return pathEntries().some((dir) => existsInDir(dir, bin));
}

export function detectAgents(): Agent[] {
  return AGENTS.filter(isAgentInstalled);
}
