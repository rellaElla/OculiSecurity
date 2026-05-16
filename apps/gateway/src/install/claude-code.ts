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

/** Claude Code hook events managed by Oculi. */
const OCULI_EVENTS = ['PreToolUse', 'PostToolUse', 'Stop'] as const;

const OCULI_MARKER = 'oculi emit claude-code';

interface CcHookEntry {
  type: string;
  command: string;
}

interface CcHookGroup {
  matcher: string;
  hooks: CcHookEntry[];
}

type HooksMap = Record<string, CcHookGroup[]>;

interface CcSettings {
  hooks?: HooksMap;
  [key: string]: unknown;
}

function resolveConfigPath(opts: InstallOpts): string {
  return path.join(opts.home ?? os.homedir(), '.claude', 'settings.json');
}

function readSettings(filePath: string): CcSettings {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as CcSettings;
}

function groupHasOculi(group: CcHookGroup): boolean {
  return group.hooks.some((h) => h.command?.includes(OCULI_MARKER));
}

export function installClaudeCode(opts: InstallOpts = {}): InstallResult {
  const configPath = resolveConfigPath(opts);
  const settings = readSettings(configPath);
  const hooksMap: HooksMap = settings.hooks ?? {};
  const added: string[] = [];

  for (const event of OCULI_EVENTS) {
    const groups: CcHookGroup[] = hooksMap[event] ?? [];
    const alreadyInstalled = groups.some(groupHasOculi);
    if (!alreadyInstalled) {
      hooksMap[event] = [
        ...groups,
        {
          matcher: '',
          hooks: [{ type: 'command', command: `oculi emit claude-code ${event}` }],
        },
      ];
      added.push(event);
    }
  }

  if (added.length > 0) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    const updated: CcSettings = { ...settings, hooks: hooksMap };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  }

  return { path: configPath, added, removed: [] };
}

export function uninstallClaudeCode(opts: InstallOpts = {}): InstallResult {
  const configPath = resolveConfigPath(opts);
  const settings = readSettings(configPath);
  const hooksMap: HooksMap = settings.hooks ?? {};
  const removed: string[] = [];

  for (const event of Object.keys(hooksMap)) {
    const before = hooksMap[event];
    const after = before.filter((g) => !groupHasOculi(g));
    if (after.length < before.length) {
      removed.push(...before.filter(groupHasOculi).map(() => event));
      if (after.length === 0) {
        delete hooksMap[event];
      } else {
        hooksMap[event] = after;
      }
    }
  }

  if (removed.length > 0) {
    const updated: CcSettings = { ...settings, hooks: hooksMap };
    fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
  }

  return { path: configPath, added: [], removed };
}

/** Does ~/.claude/settings.json still have any oculi-marked hook? */
export function hasOculiHooks(home?: string): boolean {
  const configPath = resolveConfigPath({ home });
  const settings = readSettings(configPath);
  const hooksMap: HooksMap = settings.hooks ?? {};
  for (const groups of Object.values(hooksMap)) {
    if (groups.some(groupHasOculi)) return true;
  }
  return false;
}
