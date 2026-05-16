import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface InstallOpts {
  /** Override the home directory (tests only). Production callers should omit this. */
  home?: string;
}

export interface InstallResult {
  path: string;
  added: string[];
  removed: string[];
}

/** Cursor hook events managed by Oculi. */
const OCULI_EVENTS = [
  'beforeShellExecution',
  'afterFileEdit',
  'beforeReadFile',
  'beforeMCPExecution',
  'stop',
] as const;

const OCULI_MARKER = 'oculi emit cursor';

function resolveConfigPath(opts: InstallOpts): string {
  return path.join(opts.home ?? os.homedir(), '.cursor', 'hooks.json');
}

function readConfig(filePath: string): { version: number; hooks: Record<string, { command: string }[]> } {
  if (!fs.existsSync(filePath)) {
    return { version: 1, hooks: {} };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as { version?: number; hooks?: Record<string, { command: string }[]> };
  return {
    version: parsed.version ?? 1,
    hooks: parsed.hooks ?? {},
  };
}

export function installCursor(opts: InstallOpts = {}): InstallResult {
  const configPath = resolveConfigPath(opts);
  const config = readConfig(configPath);
  const added: string[] = [];

  for (const event of OCULI_EVENTS) {
    const entries = config.hooks[event] ?? [];
    const alreadyInstalled = entries.some((e) => e.command.includes(OCULI_MARKER));
    if (!alreadyInstalled) {
      config.hooks[event] = [...entries, { command: `oculi emit cursor ${event}` }];
      added.push(event);
    }
  }

  if (added.length > 0) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  }

  return { path: configPath, added, removed: [] };
}

export function uninstallCursor(opts: InstallOpts = {}): InstallResult {
  const configPath = resolveConfigPath(opts);
  const config = readConfig(configPath);
  const removed: string[] = [];

  for (const event of Object.keys(config.hooks)) {
    const before = config.hooks[event];
    const after = before.filter((e) => !e.command.includes(OCULI_MARKER));
    if (after.length < before.length) {
      removed.push(...before.filter((e) => e.command.includes(OCULI_MARKER)).map(() => event));
      if (after.length === 0) {
        delete config.hooks[event];
      } else {
        config.hooks[event] = after;
      }
    }
  }

  if (removed.length > 0) {
    if (Object.keys(config.hooks).length === 0) {
      fs.writeFileSync(configPath, JSON.stringify({ version: config.version, hooks: {} }, null, 2) + '\n', 'utf8');
    } else {
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    }
  }

  return { path: configPath, added: [], removed };
}

/** Does ~/.cursor/hooks.json still have any oculi-marked hook? */
export function hasOculiHooks(home?: string): boolean {
  const configPath = resolveConfigPath({ home });
  const config = readConfig(configPath);
  for (const entries of Object.values(config.hooks)) {
    if (entries.some((e) => e.command.includes(OCULI_MARKER))) return true;
  }
  return false;
}
