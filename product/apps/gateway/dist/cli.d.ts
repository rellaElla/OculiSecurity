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
export {};
//# sourceMappingURL=cli.d.ts.map