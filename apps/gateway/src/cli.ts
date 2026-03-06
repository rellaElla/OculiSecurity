#!/usr/bin/env node
/**
 * Oculi CLI — hook router + installer.
 *
 * Subcommands:
 *   oculi emit [adapter]              — read stdin, route to gateway (default behaviour)
 *   oculi install <cursor|claude-code> [--global] [--dry-run]
 *   oculi uninstall <cursor|claude-code> [--global] [--dry-run]
 *   oculi init <minimal|standard|strict> — create .oculi/policy.yaml from a template
 *   oculi tail [--filter <action>] [--no-color] — live-stream telemetry log
 *   oculi report [--json] [--hours N]  — summarize recent telemetry
 *
 * Backwards-compat: `oculi claude-code` (no subcommand) still works as emit.
 *
 * Environment variables (emit only):
 *   GATEWAY_URL    Base URL of the Oculi gateway  (default: http://localhost:3000)
 *   GATEWAY_TOKEN  Bearer token for gateway auth  (optional)
 */

import { routeStdin, registeredAdapters } from './routes/adapters/router';
import { installCursor, uninstallCursor } from './install/cursor';
import { installClaudeCode, uninstallClaudeCode } from './install/claude-code';
import { findPolicyFile, loadPolicyFile, evaluateLocalPolicy } from './services/local-policy';
import { eventToLogEntry, appendTelemetry } from './services/telemetry-log';
import { runInit as execInit } from './init';
import { TEMPLATE_NAMES } from './services/local-policy-templates';
import { runTail, TailOptions } from './commands/tail';
import { runReport, ReportOptions } from './commands/report';

// ── helpers ──────────────────────────────────────────────────────────────────

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
          const reason = `denied by local policy: ${denyIds}`;
          process.stderr.write(`oculi: ${reason}\n`);
          process.stdout.write(result.adapter.formatDeny(reason));
          logTelemetry(result.event, 'deny', localRuleIds);
          process.exit(2);
        }

        if (policyResult.action === 'warn') {
          const warnIds = policyResult.matchedRules
            .filter((r) => r.action === 'warn')
            .map((r) => r.id)
            .join(', ');
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

  let res: Response;
  try {
    res = await fetch(`${gatewayUrl}/v1/hooks`, {
      method: 'POST',
      headers,
      body: stdin,
    });
  } catch {
    process.stderr.write(`oculi: gateway unreachable (${gatewayUrl}) — failing open\n`);
    process.stdout.write(result.adapter.formatAllow());
    logTelemetry(result.event, localDecision, localRuleIds);
    process.exit(0);
  }

  // Determine final decision from gateway response
  const responseText = await res.text();
  const gatewayDecision: 'allow' | 'deny' = res.ok ? 'allow' : 'deny';
  // Use the most restrictive decision between local and gateway
  const finalDecision = localDecision === 'warn' ? 'warn'
    : gatewayDecision === 'deny' ? 'deny'
    : localDecision;

  logTelemetry(result.event, finalDecision, localRuleIds);

  process.stdout.write(responseText);
  process.exit(res.ok ? 0 : 1);
}

// ── install / uninstall ───────────────────────────────────────────────────────

const SUPPORTED_TARGETS = ['cursor', 'claude-code'] as const;
type Target = (typeof SUPPORTED_TARGETS)[number];

function parseInstallArgs(argv: string[]): { target: Target; global: boolean; dryRun: boolean } {
  const [target, ...flags] = argv;

  if (!SUPPORTED_TARGETS.includes(target as Target)) {
    process.stderr.write(
      `oculi: unknown target '${target ?? ''}'. Supported: ${SUPPORTED_TARGETS.join(', ')}\n`,
    );
    process.exit(1);
  }

  return {
    target: target as Target,
    global: hasFlag(flags, '--global'),
    dryRun: hasFlag(flags, '--dry-run'),
  };
}

async function runInstall(argv: string[]): Promise<void> {
  const { target, global: isGlobal, dryRun } = parseInstallArgs(argv);
  const opts = { global: isGlobal, dryRun };

  const result =
    target === 'cursor' ? installCursor(opts) : installClaudeCode(opts);

  const scope = isGlobal ? 'global' : 'project';
  const prefix = dryRun ? '[dry-run] ' : '';

  if (result.added.length === 0) {
    process.stdout.write(`${prefix}oculi hooks already installed (${scope}): ${result.path}\n`);
  } else {
    process.stdout.write(`${prefix}Installed oculi hooks (${scope}): ${result.path}\n`);
    for (const event of result.added) {
      process.stdout.write(`  + ${event}\n`);
    }
  }
}

async function runUninstall(argv: string[]): Promise<void> {
  const { target, global: isGlobal, dryRun } = parseInstallArgs(argv);
  const opts = { global: isGlobal, dryRun };

  const result =
    target === 'cursor' ? uninstallCursor(opts) : uninstallClaudeCode(opts);

  const scope = isGlobal ? 'global' : 'project';
  const prefix = dryRun ? '[dry-run] ' : '';

  if (result.removed.length === 0) {
    process.stdout.write(`${prefix}No oculi hooks found (${scope}): ${result.path}\n`);
  } else {
    process.stdout.write(`${prefix}Removed oculi hooks (${scope}): ${result.path}\n`);
    for (const event of result.removed) {
      process.stdout.write(`  - ${event}\n`);
    }
  }
}

// ── init ─────────────────────────────────────────────────────────────────────

function runInitCommand(argv: string[]): void {
  const templateName = argv[0];

  if (!templateName) {
    process.stderr.write(
      `oculi: usage: oculi init <${TEMPLATE_NAMES.join('|')}>\n`,
    );
    process.exit(1);
  }

  try {
    const result = execInit(templateName);

    if (!result.created) {
      process.stdout.write(`oculi: policy file already exists: ${result.path}\n`);
    } else {
      process.stdout.write(`Created ${result.path} (template: ${result.template})\n`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`oculi: ${msg}\n`);
    process.exit(1);
  }
}

// ── tail ─────────────────────────────────────────────────────────────────────

function runTailCommand(argv: string[]): void {
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

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const [subcmd, ...rest] = argv;

  if (!subcmd || subcmd === 'emit') {
    await runEmit(rest);
  } else if (subcmd === 'install') {
    await runInstall(rest);
  } else if (subcmd === 'uninstall') {
    await runUninstall(rest);
  } else if (subcmd === 'init') {
    runInitCommand(rest);
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
