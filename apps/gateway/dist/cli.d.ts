#!/usr/bin/env node
/**
 * Oculi CLI — hook router + installer.
 *
 * Subcommands:
 *   oculi emit [adapter]                  — read stdin, route to gateway (default behaviour)
 *   oculi init [--agent <name>]           — write .oculi/policy.yaml + wire agent hooks
 *   oculi uninstall [--agent <name>]      — remove Oculi hooks (and policy when no agent remains)
 *   oculi serve [options]                 — start the gateway + dashboard
 *   oculi tail [--filter <action>]        — live-stream telemetry log
 *   oculi report [--json] [--hours N]     — summarize recent telemetry
 *
 * Environment variables (emit only):
 *   GATEWAY_URL    Base URL of the Oculi gateway  (default: http://localhost:3000)
 *   GATEWAY_TOKEN  Bearer token for gateway auth  (optional)
 */
export {};
