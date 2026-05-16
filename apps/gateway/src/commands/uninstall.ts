import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Agent, AGENTS } from '../install/detect';
import { uninstallClaudeCode, hasOculiHooks as claudeHasOculi } from '../install/claude-code';
import { uninstallCursor, hasOculiHooks as cursorHasOculi } from '../install/cursor';

export interface UninstallOpts {
  agent?: Agent;
  /** Override the home directory (tests only). Production callers should omit this. */
  home?: string;
}

export interface UninstallResult {
  exitCode: 0;
  removed: Partial<Record<Agent, string[]>>;
  policyRemoved: boolean;
  remainingAgents: Agent[];
}

const AGENT_LABEL: Record<Agent, { configPath: string }> = {
  'claude-code': { configPath: '~/.claude/settings.json' },
  cursor: { configPath: '~/.cursor/hooks.json' },
};

/** Render an absolute path with the user's home dir collapsed to ~. */
function tilde(absPath: string, home: string): string {
  return absPath.startsWith(home) ? '~' + absPath.slice(home.length) : absPath;
}

function agentHasOculi(agent: Agent, home: string): boolean {
  return agent === 'claude-code' ? claudeHasOculi(home) : cursorHasOculi(home);
}

export function runUninstall(opts: UninstallOpts = {}): UninstallResult {
  const home = opts.home ?? os.homedir();
  const explicit = opts.agent !== undefined;
  const targets: Agent[] = opts.agent ? [opts.agent] : [...AGENTS];
  const policyPath = path.join(home, '.oculi', 'policy.yaml');
  const policyExistedBefore = fs.existsSync(policyPath);

  // Remove hooks for each target. Existing per-agent uninstallers preserve
  // non-oculi entries — we never write JSON files directly here.
  const removed: Partial<Record<Agent, string[]>> = {};
  for (const a of targets) {
    const r = a === 'claude-code' ? uninstallClaudeCode({ home }) : uninstallCursor({ home });
    removed[a] = r.removed;
  }

  // After per-agent uninstall, recompute which agents still have oculi markers
  // on disk. We scan BOTH agents regardless of which one we just touched.
  const remainingAgents: Agent[] = AGENTS.filter((a) => agentHasOculi(a, home));

  // Policy removal rule: delete ~/.oculi/policy.yaml iff no agent has an oculi marker.
  let policyRemoved = false;
  if (remainingAgents.length === 0 && policyExistedBefore) {
    try {
      fs.rmSync(policyPath);
      policyRemoved = true;
    } catch {
      // best effort
    }
    // NOTE: do NOT rmdir ~/.oculi/ — the dashboard's oculi.db and telemetry.jsonl
    // live there. Only the policy file is owned by us.
  }

  // Build stdout.
  const changes: string[] = [];
  const notices: string[] = [];

  for (const a of targets) {
    const ev = removed[a] ?? [];
    const cfg = AGENT_LABEL[a].configPath;
    if (ev.length > 0) {
      changes.push(`Removed ${a} hooks ← ${cfg}`);
      for (const e of ev) changes.push(`  - ${e}`);
    } else if (explicit) {
      notices.push(`No oculi hooks found for ${a} in ${cfg}.`);
    }
  }

  if (policyRemoved) {
    changes.push(`Removed ${tilde(policyPath, home)}`);
  } else if (policyExistedBefore && remainingAgents.length > 0) {
    notices.push(
      `Leaving ${tilde(policyPath, home)} in place (${remainingAgents.join(', ')} is still wired).`,
    );
  }

  if (changes.length === 0 && notices.length === 0) {
    process.stdout.write(
      `Nothing to remove — no oculi hooks or policy found.\n`,
    );
  } else {
    process.stdout.write([...changes, ...notices].join('\n') + '\n');
  }

  return { exitCode: 0, removed, policyRemoved, remainingAgents };
}
