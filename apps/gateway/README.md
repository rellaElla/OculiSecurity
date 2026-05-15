# Oculi

Visibility and control for AI coding agents.

You can't see what your AI coding agent is actually doing. Tool calls — shell commands, file edits, MCP requests — execute and disappear into the chat scrollback. When the agent does something wrong, you find out after, by re-reading the transcript or auditing your repo.

Oculi gives you that view, and lets you stop the agent when it's about to do something you don't want. It runs locally and hooks into Claude Code and Cursor at the tool-call boundary. A policy file decides what to allow, warn on, or block. No SDK integration, no changes to the agent itself — just hooks the agent already exposes.

## Install

```bash
npm install -g @oculisecurity/cli
```

Requires Node.js 20 or newer.

## 60-second demo

In your project directory:

```bash
oculi init standard
oculi install claude-code
```

`init` writes a `.oculi/policy.yaml` with sensible defaults. `install` adds Oculi to your `.claude/settings.json` hooks (it doesn't overwrite anything you've configured).

In a separate terminal:

```bash
oculi serve
```

That brings up the local dashboard at <http://127.0.0.1:3000/admin/>. Leave it running.

Back in Claude Code, in the same project directory, prompt:

> Run `rm -rf /tmp/oculi-demo-scratch` to clean up.

Claude Code's Bash tool call is blocked. The reason `Blocked by Oculi rule: no-rm-rf` surfaces in the agent UI, and the event appears in the dashboard with the rule name, the command, the timestamp, and the session ID.

## What works today

- Claude Code hooks: PreToolUse, PostToolUse, Stop
- Cursor hooks: beforeShellExecution, beforeReadFile, afterFileEdit, before/afterMCPExecution, stop
- Local policy evaluation with four rule types: tool-name match, shell command regex, file-path regex, MCP server match
- Real-time dashboard with audit search, filters, and per-decision views
- SQLite audit log at `~/.oculi/oculi.db` — survives restarts

## What's coming

- Windsurf installer (the emit adapter exists; the auto-install path is in progress)
- First-class warning visualization in the dashboard
- Multi-developer central gateway for fleet visibility
- Scoped credential injection at the tool-call boundary

## Documentation

Full configuration reference, policy syntax, and integration guides: <https://oculisecurity.com/docs>

## License

Oculi Source-Available License. Free for use up to 100,000 events per day per organization. See [LICENSE.txt](./LICENSE.txt) for full terms.

---

© 2026 Oculi Security LLC.
