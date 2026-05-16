import * as os from 'os';
import { Agent, BINARIES, detectAgents, isAgentInstalled } from '../install/detect';
import { installClaudeCode } from '../install/claude-code';
import { installCursor } from '../install/cursor';
import { runInit as writePolicyIfMissing, InitResult as PolicyResult } from '../init';

export interface InitOpts {
  agent?: Agent;
  /** Override the home directory (tests only). Production callers should omit this. */
  home?: string;
}

export interface InitResult {
  exitCode: 0 | 1;
  policyPath: string | null;
  policyCreated: boolean;
  wired: Agent[];
  added: Partial<Record<Agent, string[]>>;
}

const AGENT_LABEL: Record<Agent, { configPath: string }> = {
  'claude-code': { configPath: '~/.claude/settings.json' },
  cursor: { configPath: '~/.cursor/hooks.json' },
};

/** Render an absolute path with the user's home dir collapsed to ~. */
function tilde(absPath: string, home: string): string {
  return absPath.startsWith(home) ? '~' + absPath.slice(home.length) : absPath;
}

export function runInit(opts: InitOpts = {}): InitResult {
  const home = opts.home ?? os.homedir();

  // 1. Resolve target agent list.
  let targets: Agent[];
  let explicit = false;
  if (opts.agent) {
    explicit = true;
    if (!isAgentInstalled(opts.agent)) {
      const bin = BINARIES[opts.agent];
      process.stderr.write(
        `oculi: '${opts.agent}' not found on PATH (looked for '${bin}').\n` +
          `If you have ${opts.agent === 'claude-code' ? 'Claude Code' : 'Cursor'} installed, make sure \`${bin}\` is on your PATH.\n` +
          `Otherwise run \`oculi init\` (no --agent) to write the policy and skip hook wiring.\n`,
      );
      return { exitCode: 1, policyPath: null, policyCreated: false, wired: [], added: {} };
    }
    targets = [opts.agent];
  } else {
    targets = detectAgents();
  }

  // 2. Write ~/.oculi/policy.yaml if missing (always — even when no agents are detected).
  const policy: PolicyResult = writePolicyIfMissing({ home });

  // 3. No agents detected → warn, don't wire, exit 0.
  if (targets.length === 0) {
    process.stdout.write(
      (policy.created
        ? `Created ${tilde(policy.path, home)}\n`
        : `policy already exists, leaving alone (${tilde(policy.path, home)})\n`) +
        `\n` +
        `No supported agents detected on PATH.\n` +
        `  - For Claude Code: install it from https://claude.com/claude-code\n` +
        `    and ensure \`claude\` is on your PATH.\n` +
        `  - For Cursor: in Cursor, run "Shell Command: Install 'cursor' command\n` +
        `    in PATH" from the command palette.\n` +
        `\n` +
        `Once an agent is on PATH, re-run \`oculi init\` to wire hooks.\n`,
    );
    return {
      exitCode: 0,
      policyPath: policy.path,
      policyCreated: policy.created,
      wired: [],
      added: {},
    };
  }

  // 4. Wire each target agent's hooks (installers are idempotent).
  const added: Partial<Record<Agent, string[]>> = {};
  for (const a of targets) {
    const r = a === 'claude-code' ? installClaudeCode({ home }) : installCursor({ home });
    added[a] = r.added;
  }

  // 5. Print stdout summary.
  let out = '';
  if (!explicit) {
    out += `Detected agents: ${targets.join(', ')}\n`;
  }
  out += policy.created
    ? `Created ${tilde(policy.path, home)}\n`
    : `policy already exists, leaving alone (${tilde(policy.path, home)})\n`;

  for (const a of targets) {
    const events = added[a] ?? [];
    const cfg = AGENT_LABEL[a].configPath;
    if (events.length === 0) {
      out += `Wired ${a} hooks → ${cfg} (already up to date)\n`;
    } else {
      out += `Wired ${a} hooks → ${cfg}\n`;
      for (const e of events) {
        out += `  + ${e}\n`;
      }
    }
  }
  out += `\nRestart your IDE for the hooks to take effect.\n`;
  out += `Then run \`oculi serve\` to view events in the dashboard.\n`;
  out += `\n`;
  out += `To remove later, run BOTH (in order):\n`;
  out += `  oculi uninstall                         # removes hooks + policy\n`;
  out += `  npm uninstall -g @oculisecurity/cli     # removes the binary\n`;
  out += `(npm uninstall alone won't clean the hooks — npm has no way to know\n`;
  out += ` about files we wrote outside our own package directory.)\n`;
  process.stdout.write(out);

  return {
    exitCode: 0,
    policyPath: policy.path,
    policyCreated: policy.created,
    wired: targets,
    added,
  };
}
