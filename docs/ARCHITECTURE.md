# Oculi — Architecture

## Overview

Oculi is an IDE-layer security control for AI coding agents. The agent (Claude Code, Cursor, Windsurf) invokes Oculi as a hook on every tool use. Oculi normalizes the event, evaluates it against local policy, logs telemetry to disk, and tells the IDE whether to allow, warn, or block the action — all on the user's machine, with no network round-trip required.

```
┌──────────────────────────────────────────────────────────────────────┐
│                     IDE (Claude Code / Cursor)                       │
│                                                                      │
│   Agent decides to call a tool (Bash, Edit, Read, MCP call, …)       │
│                              │                                       │
│                              ▼                                       │
│                    Hook fires → `oculi emit`                         │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  stdin: raw hook JSON
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        oculi emit (CLI)                              │
│                                                                      │
│  ┌────────────────┐  ┌───────────────────┐  ┌─────────────────────┐  │
│  │  Adapter       │─▶│  Policy Engine    │─▶│  Telemetry Log      │  │
│  │  detect +      │  │  .oculi/          │  │  .oculi/            │  │
│  │  normalize     │  │   policy.yaml     │  │   telemetry.jsonl   │  │
│  └────────────────┘  └─────────┬─────────┘  └─────────────────────┘  │
│                                │                                     │
│                                ▼                                     │
│                  deny → exit 2  (IDE blocks the action)              │
│                  warn → exit 0 + warning printed                     │
│                  allow → exit 0                                      │
│                                │                                     │
│                                ▼ (optional)                          │
│              POST to local gateway for dashboard                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼ (optional)
┌──────────────────────────────────────────────────────────────────────┐
│              oculi serve  —  Local Gateway + Dashboard               │
│                          (127.0.0.1:3000)                            │
│                                                                      │
│   Receives events, persists to SQLite, serves the admin UI at        │
│   /admin/. Zero-config for local dev; JWT auth available for         │
│   non-localhost binds.                                               │
└──────────────────────────────────────────────────────────────────────┘
```

## Components

### CLI — `apps/gateway/src/cli.ts`

The `oculi` binary is the single entry point. Subcommands:

| Subcommand | Purpose |
|---|---|
| `oculi init [--agent <name>]` | Write `.oculi/policy.yaml` and wire hooks for detected agents |
| `oculi uninstall [--agent <name>]` | Remove Oculi hooks (and policy when none remain) |
| `oculi serve [options]` | Start the local gateway + dashboard |
| `oculi emit [adapter]` | Hook handler — read stdin, evaluate policy (called by IDEs) |
| `oculi tail [--filter X]` | Live-stream the telemetry log |
| `oculi report [--json] [--hours N]` | Summarize recent events |

### Agent detection — `src/install/detect.ts`

Walks `process.env.PATH` and checks `fs.existsSync` for each agent's binary (`claude`, `cursor`). Used by `oculi init` to pick which agents to wire. No npm dependency; works on POSIX and Windows (`.cmd` / `.exe` / `.bat` fallbacks).

### Installers — `src/install/{claude-code,cursor}.ts`

Each installer owns one agent's hook config:

- **Claude Code** → `.claude/settings.json` — events: `PreToolUse`, `PostToolUse`, `Stop`.
- **Cursor** → `.cursor/hooks.json` — events: `beforeShellExecution`, `afterFileEdit`, `beforeReadFile`, `beforeMCPExecution`, `stop`.

Installers identify their own entries by an `oculi emit <agent>` marker substring. Merging is careful: existing user-authored hook entries are preserved on install, and only Oculi-marked entries are removed on uninstall. The orchestrator never writes the JSON files directly — it always goes through the per-agent installers.

### Init / Uninstall orchestrators — `src/commands/{init,uninstall}.ts`

`runInit` composes: detect → write policy → install hooks for each detected agent. `runUninstall` composes: uninstall hooks → if no agent has Oculi markers on disk, delete `.oculi/policy.yaml`.

### Adapters — `src/routes/adapters/{claude-code,cursor,windsurf}.ts`

Each adapter implements:

```typescript
interface HookAdapter {
  detect(body: Record<string, unknown>): boolean;
  normalize(body: Record<string, unknown>): OculiEvent;
  formatAllow(): string;
  formatDeny(reason: string): string;
  denyStatusCode(): number;
}
```

`normalize()` produces a standard `OculiEvent` with `tool` ∈ `{ shell, file_read, file_edit, mcp_call, session_stop }` and the appropriate `shell_command` / `file_path` / `mcp_server` field populated. This lets a single policy work across IDEs without translation.

### Policy engine — `src/services/local-policy.ts`

Reads `.oculi/policy.yaml` (walking up from cwd to find it). Each rule has a `match` block (AND-ed across fields) and an `action` of `deny`, `warn`, or `allow`. Precedence when multiple rules match: **deny > warn > allow**. Only `pre`-phase events are evaluated for blocking; post-phase events are logged but never block.

### Telemetry — `src/services/telemetry-log.ts`

Appends one JSON line per event to `.oculi/telemetry.jsonl`, rotated at 10 MB (5 rotations kept). `oculi tail` and `oculi report` read this file directly.

### Local gateway — `src/commands/serve.ts` + `src/server.ts`

`oculi serve` starts a local Fastify server at `127.0.0.1:3000` (configurable) with the admin dashboard at `/admin/`. Events forwarded by `oculi emit` are persisted to SQLite for the dashboard.

Zero-config defaults (localhost-only):
- No auth, no rate limiting, no upstreams.
- Telemetry persisted in `~/.oculi/` by default; configurable with `--data-dir`.

Non-localhost binds (`--bind 0.0.0.0`) require `--auth <secret>` (or `OCULI_GATEWAY_TOKEN` env var) — the server refuses to start otherwise.

## Event flow

1. Agent in the IDE decides to call a tool.
2. IDE fires the configured hook command: `oculi emit <agent>` with the event payload on stdin.
3. `oculi emit` reads stdin, routes via the adapter registry, normalizes to `OculiEvent`.
4. Policy engine evaluates the event against `.oculi/policy.yaml`.
5. Telemetry log entry is appended.
6. Event is optionally POSTed to `GATEWAY_URL` for the dashboard.
7. CLI exits with `0` (allow/warn) or `2` (deny). The IDE reads the exit code and either proceeds or blocks the action.

## Data on disk

| Path | Owner | Purpose |
|---|---|---|
| `./.oculi/policy.yaml` | project | Rule set evaluated for every event |
| `./.oculi/telemetry.jsonl` | project | Append-only event log (10 MB × 5 rotations) |
| `./.claude/settings.json` | project | Claude Code's hook config — Oculi merges entries in |
| `./.cursor/hooks.json` | project | Cursor's hook config — same |
| `~/.oculi/oculi.db` | user | SQLite store the dashboard reads from |

## Threat model

- **Local-only by default.** No code leaves the user's machine unless they run `oculi serve` and forward events.
- **Hook integrity.** Oculi assumes the agent honors its hook contract (exit code 2 blocks the action). A compromised IDE can ignore hooks; this control is a guardrail, not a sandbox.
- **Policy file integrity.** `.oculi/policy.yaml` is a regular file on the user's filesystem. Treat it as you'd treat any other config — if the agent can write to it, the agent can disarm the policy. Keep policies in source control if that's a concern.
- **Telemetry confidentiality.** `.oculi/telemetry.jsonl` may contain sensitive command/file contents. It's project-local by default. Add it to `.gitignore` if you don't want it committed.
