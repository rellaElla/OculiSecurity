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
export {};
