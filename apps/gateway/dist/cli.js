#!/usr/bin/env node
"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = require("fs");
const path_1 = require("path");
const router_1 = require("./routes/adapters/router");
const cursor_1 = require("./install/cursor");
const claude_code_1 = require("./install/claude-code");
const local_policy_1 = require("./services/local-policy");
const telemetry_log_1 = require("./services/telemetry-log");
const init_1 = require("./init");
const local_policy_templates_1 = require("./services/local-policy-templates");
const tail_1 = require("./commands/tail");
const report_1 = require("./commands/report");
// ── version + help text ───────────────────────────────────────────────────────
let cachedVersion = null;
function getVersion() {
    if (cachedVersion !== null)
        return cachedVersion;
    try {
        const pkgPath = (0, path_1.join)(__dirname, '..', 'package.json');
        const pkg = JSON.parse((0, fs_1.readFileSync)(pkgPath, 'utf8'));
        cachedVersion = pkg.version ?? 'unknown';
    }
    catch {
        cachedVersion = 'unknown';
    }
    return cachedVersion;
}
const TOP_LEVEL_HELP = `oculi — security layer for AI coding agents

Usage:
  oculi <command> [options]

Commands:
  init <template>          Create .oculi/policy.yaml (templates: minimal, standard)
  install <target>         Install hooks for an IDE (targets: claude-code, cursor)
  uninstall <target>       Remove hooks for an IDE
  emit [adapter]           Process a hook event from stdin (called by IDEs)
  tail [--filter <kind>]   Live-stream telemetry log
  report [--json] [--hours N]   Summarize recent events

Run \`oculi <command> --help\` for command-specific help.

Environment variables:
  GATEWAY_URL              Gateway URL for hook forwarding (default: http://localhost:3000)
  GATEWAY_TOKEN            Bearer token for gateway auth (optional)
  NO_COLOR                 Disable ANSI colors in tail output

Documentation: https://docs.oculisecurity.com
`;
const INIT_HELP = `oculi init — create a local policy file

Usage:
  oculi init <template>

Templates:
  minimal     Empty rule set; nothing blocked
  standard    Common safety rules (deny rm -rf, warn on .env/MCP access)

Writes .oculi/policy.yaml in the current directory. If the file already
exists, prints a notice and exits 0 without overwriting.

Example:
  oculi init standard
`;
const INSTALL_HELP = `oculi install — install hooks into an IDE

Usage:
  oculi install <target> [--global] [--dry-run]

Targets:
  claude-code    Merge hooks into .claude/settings.json
  cursor         Merge hooks into .cursor/hooks.json

Options:
  --global       Install into ~/.<target>/ instead of project-local
  --dry-run      Print what would change without writing files

Idempotent: running twice is a no-op the second time. Existing user-authored
hooks are preserved.

Example:
  oculi install claude-code
`;
const UNINSTALL_HELP = `oculi uninstall — remove hooks from an IDE

Usage:
  oculi uninstall <target> [--global] [--dry-run]

Targets:
  claude-code    Remove oculi hooks from .claude/settings.json
  cursor         Remove oculi hooks from .cursor/hooks.json

Options:
  --global       Operate on ~/.<target>/ instead of project-local
  --dry-run      Print what would change without writing files

Removes only the entries oculi added; other hooks are preserved.

Example:
  oculi uninstall claude-code
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
  0   allowed
  1   denied by gateway, or usage/network error
  2   denied by local policy

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
function hasHelpFlag(argv) {
    return argv.includes('--help') || argv.includes('-h');
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8').trim();
}
function hasFlag(argv, flag) {
    return argv.includes(flag);
}
// ── emit ──────────────────────────────────────────────────────────────────────
function logTelemetry(event, decision, ruleIds = []) {
    try {
        const entry = (0, telemetry_log_1.eventToLogEntry)(event, decision, ruleIds);
        (0, telemetry_log_1.appendTelemetry)(entry);
    }
    catch {
        // Telemetry logging is best-effort — never block the hook response
    }
}
async function runEmit(argv) {
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
    let adapterName;
    if (flagIdx !== -1) {
        adapterName = argv[flagIdx + 1];
    }
    else {
        adapterName = argv.find((a) => !a.startsWith('--'));
    }
    const result = (0, router_1.routeStdin)(stdin, adapterName);
    if (!result) {
        const known = (0, router_1.registeredAdapters)().join(', ');
        process.stderr.write(adapterName
            ? `oculi: unknown adapter '${adapterName}'. Known: ${known}\n`
            : `oculi: could not auto-detect adapter from payload. Supported: ${known}\n`);
        process.exit(1);
    }
    // ── Local policy evaluation (client-side, against OculiEvent) ─────────────
    let localDecision = 'allow';
    let localRuleIds = [];
    const policyPath = (0, local_policy_1.findPolicyFile)();
    if (policyPath) {
        try {
            const policyFile = (0, local_policy_1.loadPolicyFile)(policyPath);
            if (policyFile.rules.length > 0) {
                const policyResult = (0, local_policy_1.evaluateLocalPolicy)(result.event, policyFile.rules);
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
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            process.stderr.write(`oculi: failed to load local policy (${policyPath}): ${msg} — skipping\n`);
        }
    }
    // ── Forward to gateway ────────────────────────────────────────────────────
    const gatewayUrl = (process.env.GATEWAY_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const token = process.env.GATEWAY_TOKEN;
    const headers = {
        'Content-Type': 'application/json',
        'X-Oculi-Adapter': result.adapterName,
    };
    if (token)
        headers['Authorization'] = `Bearer ${token}`;
    let res;
    try {
        res = await fetch(`${gatewayUrl}/v1/hooks`, {
            method: 'POST',
            headers,
            body: stdin,
        });
    }
    catch {
        process.stderr.write(`oculi: gateway unreachable (${gatewayUrl}) — failing open\n`);
        process.stdout.write(result.adapter.formatAllow());
        logTelemetry(result.event, localDecision, localRuleIds);
        process.exit(0);
    }
    // Determine final decision from gateway response
    const responseText = await res.text();
    const gatewayDecision = res.ok ? 'allow' : 'deny';
    // Use the most restrictive decision between local and gateway
    const finalDecision = localDecision === 'warn' ? 'warn'
        : gatewayDecision === 'deny' ? 'deny'
            : localDecision;
    logTelemetry(result.event, finalDecision, localRuleIds);
    process.stdout.write(responseText);
    process.exit(res.ok ? 0 : 1);
}
// ── install / uninstall ───────────────────────────────────────────────────────
const SUPPORTED_TARGETS = ['cursor', 'claude-code'];
function parseInstallArgs(argv) {
    const [target, ...flags] = argv;
    if (!SUPPORTED_TARGETS.includes(target)) {
        process.stderr.write(`oculi: unknown target '${target ?? ''}'. Supported: ${SUPPORTED_TARGETS.join(', ')}\n`);
        process.exit(1);
    }
    return {
        target: target,
        global: hasFlag(flags, '--global'),
        dryRun: hasFlag(flags, '--dry-run'),
    };
}
async function runInstall(argv) {
    if (hasHelpFlag(argv)) {
        process.stdout.write(INSTALL_HELP);
        process.exit(0);
    }
    const { target, global: isGlobal, dryRun } = parseInstallArgs(argv);
    const opts = { global: isGlobal, dryRun };
    const result = target === 'cursor' ? (0, cursor_1.installCursor)(opts) : (0, claude_code_1.installClaudeCode)(opts);
    const scope = isGlobal ? 'global' : 'project';
    const prefix = dryRun ? '[dry-run] ' : '';
    if (result.added.length === 0) {
        process.stdout.write(`${prefix}oculi hooks already installed (${scope}): ${result.path}\n`);
    }
    else {
        process.stdout.write(`${prefix}Installed oculi hooks (${scope}): ${result.path}\n`);
        for (const event of result.added) {
            process.stdout.write(`  + ${event}\n`);
        }
    }
}
async function runUninstall(argv) {
    if (hasHelpFlag(argv)) {
        process.stdout.write(UNINSTALL_HELP);
        process.exit(0);
    }
    const { target, global: isGlobal, dryRun } = parseInstallArgs(argv);
    const opts = { global: isGlobal, dryRun };
    const result = target === 'cursor' ? (0, cursor_1.uninstallCursor)(opts) : (0, claude_code_1.uninstallClaudeCode)(opts);
    const scope = isGlobal ? 'global' : 'project';
    const prefix = dryRun ? '[dry-run] ' : '';
    if (result.removed.length === 0) {
        process.stdout.write(`${prefix}No oculi hooks found (${scope}): ${result.path}\n`);
    }
    else {
        process.stdout.write(`${prefix}Removed oculi hooks (${scope}): ${result.path}\n`);
        for (const event of result.removed) {
            process.stdout.write(`  - ${event}\n`);
        }
    }
}
// ── init ─────────────────────────────────────────────────────────────────────
function runInitCommand(argv) {
    if (hasHelpFlag(argv)) {
        process.stdout.write(INIT_HELP);
        process.exit(0);
    }
    const templateName = argv[0];
    if (!templateName) {
        process.stderr.write(`oculi: usage: oculi init <${local_policy_templates_1.TEMPLATE_NAMES.join('|')}>\n`);
        process.exit(1);
    }
    try {
        const result = (0, init_1.runInit)(templateName);
        if (!result.created) {
            process.stdout.write(`oculi: policy file already exists: ${result.path}\n`);
        }
        else {
            process.stdout.write(`Created ${result.path} (template: ${result.template})\n`);
        }
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`oculi: ${msg}\n`);
        process.exit(1);
    }
}
// ── tail ─────────────────────────────────────────────────────────────────────
function runTailCommand(argv) {
    if (hasHelpFlag(argv)) {
        process.stdout.write(TAIL_HELP);
        process.exit(0);
    }
    const filterIdx = argv.indexOf('--filter');
    let filter;
    if (filterIdx !== -1) {
        const val = argv[filterIdx + 1];
        if (val === 'allow' || val === 'warn' || val === 'deny') {
            filter = val;
        }
    }
    (0, tail_1.runTail)({
        filter,
        noColor: hasFlag(argv, '--no-color'),
    });
}
// ── report ───────────────────────────────────────────────────────────────────
function runReportCommand(argv) {
    if (hasHelpFlag(argv)) {
        process.stdout.write(REPORT_HELP);
        process.exit(0);
    }
    const hoursIdx = argv.indexOf('--hours');
    let hours = 24;
    if (hoursIdx !== -1) {
        const val = parseInt(argv[hoursIdx + 1], 10);
        if (!isNaN(val) && val > 0)
            hours = val;
    }
    (0, report_1.runReport)({
        json: hasFlag(argv, '--json'),
        hours,
    });
}
// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
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
    }
    else if (subcmd === 'install') {
        await runInstall(rest);
    }
    else if (subcmd === 'uninstall') {
        await runUninstall(rest);
    }
    else if (subcmd === 'init') {
        runInitCommand(rest);
    }
    else if (subcmd === 'tail') {
        runTailCommand(rest);
    }
    else if (subcmd === 'report') {
        runReportCommand(rest);
    }
    else {
        // Backwards-compat: `oculi claude-code` with no subcommand → emit
        await runEmit(argv);
    }
}
main().catch((err) => {
    process.stderr.write(`oculi: ${err.message}\n`);
    process.exit(1);
});
