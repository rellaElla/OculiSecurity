#!/usr/bin/env node
/**
 * Oculi CLI — hook router + installer.
 *
 * Subcommands:
 *   oculi emit [adapter]                  — read stdin, route to gateway (default behaviour)
 *   oculi install [--agent <name>]        — wire user-level hooks + write ~/.oculi/policy.yaml
 *   oculi init [--agent <name>]           — alias of install (legacy name)
 *   oculi uninstall [--agent <name>]      — remove Oculi hooks (and policy when no agent remains)
 *   oculi serve [options]                 — start the gateway + dashboard
 *   oculi tail [--filter <action>]        — live-stream telemetry log
 *   oculi report [--json] [--hours N]     — summarize recent telemetry
 *
 * Environment variables (emit only):
 *   GATEWAY_URL    Base URL of the Oculi gateway  (default: http://localhost:3000)
 *   GATEWAY_TOKEN  Bearer token for gateway auth  (optional)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { routeStdin, registeredAdapters } from './routes/adapters/router';
import { findPolicyFile, loadPolicyFile, evaluateLocalPolicy } from './services/local-policy';
import { eventToLogEntry, appendTelemetry } from './services/telemetry-log';
import { AGENTS, type Agent } from './install/detect';
import { runInit } from './commands/init';
import { runUninstall } from './commands/uninstall';
import { runTail, TailOptions } from './commands/tail';
import { runReport, ReportOptions } from './commands/report';
import { runServe, ServeOpts } from './commands/serve';
import { defaultDataDir } from './services/data-dir';

// ── version + help text ───────────────────────────────────────────────────────

let cachedVersion: string | null = null;
function getVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const pkgPath = join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    cachedVersion = pkg.version ?? 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

const TOP_LEVEL_HELP = `oculi — security layer for AI coding agents

Usage:
  oculi <command> [options]

Commands:
  install [--agent <name>]   Wire user-level hooks (~/.claude/settings.json) and
                             write ~/.oculi/policy.yaml — captures every Claude
                             Code session on this machine.
  uninstall [--agent <name>] Remove Oculi hooks (and policy when nothing remains wired)
  serve [options]            Start the gateway + dashboard (zero-config localhost)
  tail [--filter <kind>]     Live-stream telemetry log (~/.oculi/telemetry.jsonl)
  report [--json] [--hours N] Summarize recent events
  emit [adapter]             Process a hook event from stdin (called by IDEs)

Run \`oculi <command> --help\` for command-specific help.

Environment variables:
  GATEWAY_URL              Gateway URL for hook forwarding (default: http://localhost:3000)
  GATEWAY_TOKEN            Bearer token for gateway auth (optional)
  NO_COLOR                 Disable ANSI colors in tail output

Documentation: https://docs.oculisecurity.com
`;

const INSTALL_HELP = `oculi install — wire user-level hooks and write policy

Usage:
  oculi install [--agent <name>]

Options:
  --agent <name>   Wire only this agent (claude-code, cursor). When omitted,
                   auto-detects installed agents on PATH and wires each.

Sets up Oculi at the user level so every Claude Code / Cursor session on this
machine — in any directory — is intercepted, evaluated against policy, and
appended to ~/.oculi/telemetry.jsonl.

Writes:
  ~/.oculi/policy.yaml          (preserved if it already exists)
  ~/.claude/settings.json       merged with PreToolUse / PostToolUse / Stop hooks
  ~/.cursor/hooks.json          merged with hook entries (if Cursor is installed)

Idempotent — safe to re-run. Existing user-authored hooks are preserved.

After install, run \`oculi tail\` to live-stream events or \`oculi serve\` to
open the dashboard at http://127.0.0.1:3000/admin.

Examples:
  oculi install                       # auto-detect, wire all installed agents
  oculi install --agent claude-code   # only wire Claude Code

Note: \`oculi init\` is a legacy alias for this command.
`;

const UNINSTALL_HELP = `oculi uninstall — remove user-level Oculi hooks

Usage:
  oculi uninstall [--agent <name>]

Options:
  --agent <name>   Remove only this agent's hooks (claude-code, cursor). When
                   omitted, removes hooks for both agents.

Removes only the entries Oculi added from ~/.claude/settings.json and
~/.cursor/hooks.json; other hooks are preserved. Also removes
~/.oculi/policy.yaml when no agent has Oculi hooks remaining.

(Telemetry files in ~/.oculi/ are left in place.)

Examples:
  oculi uninstall                  # remove all Oculi hooks
  oculi uninstall --agent cursor   # remove only Cursor's hooks
`;

const EMIT_HELP = `oculi emit — process a hook event from stdin

Reads a hook payload from stdin, evaluates local policy, forwards to the
gateway, and logs telemetry. Invoked by IDE hook commands; rarely run
directly.

Usage:
  oculi emit [adapter]
  oculi emit --adapter <name>

Adapters:
  claude-code, cursor, windsurf
  (auto-detected from payload if not specified)

Exit codes:
  0   allowed (including fail-open when gateway is unreachable)
  1   usage or parse error
  2   denied by local policy or gateway

Example:
  echo '{"hook_event_name":"PreToolUse",...}' | oculi emit claude-code
`;

const TAIL_HELP = `oculi tail — live-stream the telemetry log

Reads .oculi/telemetry.jsonl from the nearest project directory (walking
up) or ~/.oculi/telemetry.jsonl, prints recent entries, and watches for
new appends. SIGINT to exit.

Usage:
  oculi tail [--filter <kind>] [--no-color]

Options:
  --filter <kind>   Show only entries with decision: allow | warn | deny
  --no-color        Disable ANSI colors (also: NO_COLOR env var)

Example:
  oculi tail --filter deny
`;

const SERVE_HELP = `oculi serve — start the gateway and dashboard

Usage:
  oculi serve [options]

Options:
  --port N             Port to listen on (default: 3000)
  --bind ADDR          Interface to bind to (default: 127.0.0.1)
                       Non-localhost binds require --auth.
  --data-dir DIR       Directory for sqlite + config (default: ~/.oculi/)
  --auth SECRET        Enable JWT auth on protected endpoints (≥32 chars).
                       Also accepted via OCULI_GATEWAY_TOKEN env var.
  --opa-url URL        Enable OPA-based central policy at this URL.
  --verbose            Enable verbose (debug-level) request logging.

Zero-config defaults (no flags, localhost):
  No auth, no OPA, no rate limit, no upstreams.
  Dashboard at http://127.0.0.1:3000/admin.

Server mode (--bind non-localhost):
  Auth required (--auth or OCULI_GATEWAY_TOKEN) — refuses to start otherwise.
  Rate limiting enabled (10 capacity / 2 per second per actor:tool).

Examples:
  oculi serve                                # local dev
  oculi serve --port 4000                    # different port
  oculi serve --bind 0.0.0.0 --auth $SEC     # enterprise deployment
`;

const REPORT_HELP = `oculi report — summarize recent telemetry

Aggregates entries from the telemetry log over a time window.

Usage:
  oculi report [--json] [--hours N]

Options:
  --json           JSON output instead of human-readable
  --hours N        Time window in hours (default: 24)

Example:
  oculi report --hours 168 --json
`;

// ── helpers ──────────────────────────────────────────────────────────────────

function hasHelpFlag(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString('utf8').trim();
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

// ── emit ──────────────────────────────────────────────────────────────────────

function logTelemetry(
  event: import('./routes/adapters/schema').OculiEvent,
  decision: 'allow' | 'warn' | 'deny',
  ruleIds: string[] = [],
): void {
  try {
    const entry = eventToLogEntry(event, decision, ruleIds);
    appendTelemetry(entry);
  } catch {
    // Telemetry logging is best-effort — never block the hook response
  }
}

async function runEmit(argv: string[]): Promise<void> {
  if (hasHelpFlag(argv)) {
    process.stdout.write(EMIT_HELP);
    process.exit(0);
  }
  const stdin = await readStdin();
  if (!stdin) {
    process.stderr.write('oculi: no input on stdin\n');
    process.exit(1);
  }

  // --adapter <name>  OR  first positional arg
  const flagIdx = argv.indexOf('--adapter');
  let adapterName: string | undefined;
  if (flagIdx !== -1) {
    adapterName = argv[flagIdx + 1];
  } else {
    adapterName = argv.find((a) => !a.startsWith('--'));
  }

  const result = routeStdin(stdin, adapterName);

  if (!result) {
    const known = registeredAdapters().join(', ');
    process.stderr.write(
      adapterName
        ? `oculi: unknown adapter '${adapterName}'. Known: ${known}\n`
        : `oculi: could not auto-detect adapter from payload. Supported: ${known}\n`,
    );
    process.exit(1);
  }

  // ── Local policy evaluation (client-side, against OculiEvent) ─────────────
  let localDecision: 'allow' | 'warn' | 'deny' = 'allow';
  let localRuleIds: string[] = [];
  let localReason: string | undefined;

  const policyPath = findPolicyFile();
  if (policyPath) {
    try {
      const policyFile = loadPolicyFile(policyPath);
      if (policyFile.rules.length > 0) {
        const policyResult = evaluateLocalPolicy(result.event, policyFile.rules);
        localDecision = policyResult.action;
        localRuleIds = policyResult.matchedRules.map((r) => r.id);

        if (policyResult.action === 'deny') {
          const denyIds = policyResult.matchedRules
            .filter((r) => r.action === 'deny')
            .map((r) => r.id)
            .join(', ');
          localReason = `Blocked by Oculi rule: ${denyIds}`;
          // Falls through to the gateway POST so the deny appears in the dashboard.
          // The pre-decided headers below tell the gateway to record it verbatim.
        }

        if (policyResult.action === 'warn') {
          const warnIds = policyResult.matchedRules
            .filter((r) => r.action === 'warn')
            .map((r) => r.id)
            .join(', ');
          localReason = `Oculi warning: ${warnIds}`;
          process.stderr.write(`oculi: warning from local policy: ${warnIds}\n`);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`oculi: failed to load local policy (${policyPath}): ${msg} — skipping\n`);
    }
  }

  // ── Forward to gateway ────────────────────────────────────────────────────
  const gatewayUrl = (process.env.GATEWAY_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const token = process.env.GATEWAY_TOKEN;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Oculi-Adapter': result.adapterName,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  // When local policy decided, tell the gateway to record it verbatim.
  // Without these headers the gateway re-evaluates with its own (central) policy,
  // which doesn't know about local rules, so the decision label would be wrong.
  if (localDecision !== 'allow') {
    headers['X-Oculi-Local-Decision'] = localDecision;
    if (localReason) headers['X-Oculi-Local-Reason'] = localReason;
    if (localRuleIds.length > 0) headers['X-Oculi-Local-Rule-Ids'] = localRuleIds.join(',');
  }

  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/v1/hooks`, {
      method: 'POST',
      headers,
      body: stdin,
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    process.stderr.write(`oculi: gateway unreachable (${gatewayUrl}) — failing open\n`);
    writeDecisionOutput(result.adapter, result.event, localDecision, localReason, undefined);
    logTelemetry(result.event, localDecision, localRuleIds);
    process.exit(0);
  }

  // Non-2xx is treated the same as unreachable: the gateway gave no usable
  // verdict, so defer to localDecision. Without this, a gateway returning 401
  // (auth misconfig) or 500 (internal error) would translate to a blanket deny.
  if (!res.ok) {
    process.stderr.write(`oculi: gateway error ${res.status} (${gatewayUrl}) — failing open\n`);
    writeDecisionOutput(result.adapter, result.event, localDecision, localReason, undefined);
    logTelemetry(result.event, localDecision, localRuleIds);
    process.exit(0);
  }

  // Gateway returned 2xx. Final decision is driven purely by localDecision —
  // for claude-code the gateway encodes verdicts in the response body, not the
  // status code, so res.ok no longer carries decision signal once we get here.
  const responseText = await res.text();
  const finalDecision: 'allow' | 'warn' | 'deny' =
    localDecision === 'deny' ? 'deny'
    : localDecision === 'warn' ? 'warn'
    : 'allow';

  // For Stop, never propagate denies — keeps Claude's stop flow predictable.
  const effectiveDecision: 'allow' | 'warn' | 'deny' =
    result.event.hook_event_name === 'Stop' ? 'allow' : finalDecision;

  logTelemetry(result.event, effectiveDecision, localRuleIds);
  writeDecisionOutput(result.adapter, result.event, effectiveDecision, localReason, responseText);
  process.exit(0);
}

/**
 * Emit the adapter's stdout response for a final decision.
 *
 * Reason precedence:
 *   - warn → localReason (always set by the local-policy warn branch)
 *   - deny → localReason if local policy decided; otherwise extract from the
 *            gateway response body; otherwise a generic "Blocked by Oculi gateway".
 */
function writeDecisionOutput(
  adapter: import('./routes/adapters').HookAdapter,
  event: import('./routes/adapters/schema').OculiEvent,
  decision: 'allow' | 'warn' | 'deny',
  localReason: string | undefined,
  gatewayBody: string | undefined,
): void {
  if (decision === 'allow') {
    process.stdout.write(adapter.formatAllow(event));
    return;
  }

  if (decision === 'warn') {
    const warnReason = localReason ?? 'Oculi warning';
    const warnOutput = adapter.formatWarn
      ? adapter.formatWarn(warnReason, event)
      : adapter.formatAllow(event);
    process.stdout.write(warnOutput);
    return;
  }

  const reason = localReason ?? extractGatewayReason(gatewayBody) ?? 'Blocked by Oculi gateway';
  process.stdout.write(adapter.formatDeny(reason, event));
}

/**
 * Best-effort extraction of a human-readable reason from a gateway response.
 * Returns the first non-empty string found among the common keys, or null.
 */
function extractGatewayReason(body: string | undefined): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    for (const key of ['reason', 'permissionDecisionReason', 'message']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
  } catch {
    // Non-JSON body — ignore.
  }
  return null;
}

// ── init / uninstall ──────────────────────────────────────────────────────────

function parseAgentFlag(argv: string[]): Agent | undefined {
  const i = argv.indexOf('--agent');
  if (i === -1) return undefined;
  const v = argv[i + 1];
  if (!v || !AGENTS.includes(v as Agent)) {
    process.stderr.write(
      `oculi: --agent expects one of: ${AGENTS.join(', ')}\n`,
    );
    process.exit(1);
  }
  return v as Agent;
}

function runInstallCommand(argv: string[]): void {
  if (hasHelpFlag(argv)) {
    process.stdout.write(INSTALL_HELP);
    process.exit(0);
  }
  const agent = parseAgentFlag(argv);
  const r = runInit({ agent });
  if (r.exitCode !== 0) process.exit(r.exitCode);
}

function runUninstallCommand(argv: string[]): void {
  if (hasHelpFlag(argv)) {
    process.stdout.write(UNINSTALL_HELP);
    process.exit(0);
  }
  const agent = parseAgentFlag(argv);
  runUninstall({ agent });
}

// ── tail ─────────────────────────────────────────────────────────────────────

function runTailCommand(argv: string[]): void {
  if (hasHelpFlag(argv)) {
    process.stdout.write(TAIL_HELP);
    process.exit(0);
  }
  const filterIdx = argv.indexOf('--filter');
  let filter: TailOptions['filter'];
  if (filterIdx !== -1) {
    const val = argv[filterIdx + 1];
    if (val === 'allow' || val === 'warn' || val === 'deny') {
      filter = val;
    }
  }

  runTail({
    filter,
    noColor: hasFlag(argv, '--no-color'),
  });
}

// ── report ───────────────────────────────────────────────────────────────────

function runReportCommand(argv: string[]): void {
  if (hasHelpFlag(argv)) {
    process.stdout.write(REPORT_HELP);
    process.exit(0);
  }
  const hoursIdx = argv.indexOf('--hours');
  let hours = 24;
  if (hoursIdx !== -1) {
    const val = parseInt(argv[hoursIdx + 1], 10);
    if (!isNaN(val) && val > 0) hours = val;
  }

  runReport({
    json: hasFlag(argv, '--json'),
    hours,
  });
}

// ── serve ────────────────────────────────────────────────────────────────────

function parseServeArgs(argv: string[]): ServeOpts {
  const opts: ServeOpts = {
    port: 3000,
    bind: '127.0.0.1',
    dataDir: defaultDataDir(),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    switch (arg) {
      case '--port':
        if (!next) throw new Error('--port requires a value');
        opts.port = parseInt(next, 10);
        if (Number.isNaN(opts.port) || opts.port <= 0 || opts.port > 65535) {
          throw new Error(`invalid --port value: ${next}`);
        }
        i++;
        break;
      case '--bind':
        if (!next) throw new Error('--bind requires a value');
        opts.bind = next;
        i++;
        break;
      case '--data-dir':
        if (!next) throw new Error('--data-dir requires a value');
        opts.dataDir = next;
        i++;
        break;
      case '--auth':
        if (!next) throw new Error('--auth requires a secret');
        opts.auth = next;
        i++;
        break;
      case '--opa-url':
        if (!next) throw new Error('--opa-url requires a value');
        opts.opaUrl = next;
        i++;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      default:
        throw new Error(`unknown serve option: ${arg}`);
    }
  }
  return opts;
}

async function runServeCommand(argv: string[]): Promise<void> {
  if (hasHelpFlag(argv)) {
    process.stdout.write(SERVE_HELP);
    process.exit(0);
  }

  let opts: ServeOpts;
  try {
    opts = parseServeArgs(argv);
  } catch (err) {
    process.stderr.write(`oculi: ${(err as Error).message}\n`);
    process.stderr.write('Run `oculi serve --help` for usage.\n');
    process.exit(1);
  }

  await runServe(opts);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [subcmd, ...rest] = argv;

  if (subcmd === '--help' || subcmd === '-h') {
    process.stdout.write(TOP_LEVEL_HELP);
    process.exit(0);
  }
  if (subcmd === '--version' || subcmd === '-v') {
    process.stdout.write(`${getVersion()}\n`);
    process.exit(0);
  }
  if (subcmd && subcmd.startsWith('-')) {
    process.stderr.write(`oculi: unknown option '${subcmd}'. Run \`oculi --help\` for usage.\n`);
    process.exit(1);
  }

  if (!subcmd || subcmd === 'emit') {
    await runEmit(rest);
  } else if (subcmd === 'serve') {
    await runServeCommand(rest);
  } else if (subcmd === 'uninstall') {
    runUninstallCommand(rest);
  } else if (subcmd === 'install' || subcmd === 'init') {
    runInstallCommand(rest);
  } else if (subcmd === 'tail') {
    runTailCommand(rest);
  } else if (subcmd === 'report') {
    runReportCommand(rest);
  } else {
    // Backwards-compat: `oculi claude-code` with no subcommand → emit
    await runEmit(argv);
  }
}

main().catch((err: Error) => {
  process.stderr.write(`oculi: ${err.message}\n`);
  process.exit(1);
});
