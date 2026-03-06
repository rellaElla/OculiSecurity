"use strict";
/**
 * Starter policy templates for `oculi init`.
 *
 * Each template is a raw YAML string (not an object) so we can include
 * comments that explain the format to the user.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.templates = exports.TEMPLATE_NAMES = void 0;
exports.TEMPLATE_NAMES = ['minimal', 'standard', 'strict'];
exports.templates = {
    // ── Minimal: log-only, no blocking ──────────────────────────────────────────
    minimal: `# Oculi local policy — minimal (log-only)
#
# This policy file does not block anything. It exists so Oculi can
# forward all hook events to the gateway for logging and auditing.
#
# Rule format:
#   - id: "unique-id"
#     match:
#       tool: shell | file_read | file_edit | mcp_call  # exact match
#       command_pattern: "regex"   # tested against shell commands
#       file_pattern: "regex"      # tested against file paths
#       mcp_server: "server-name"  # exact match on MCP server
#     action: deny | warn | allow
#
# Precedence when multiple rules match: deny > warn > allow
#
# Uncomment the example below to get started:
#
# rules:
#   - id: "warn-destructive-shell"
#     match:
#       tool: shell
#       command_pattern: "rm\\\\s+-rf"
#     action: warn

rules: []
`,
    // ── Standard: sensible defaults ─────────────────────────────────────────────
    standard: `# Oculi local policy — standard (sensible defaults)
#
# Blocks dangerous shell commands and path traversal.
# Warns on .env file access and MCP tool calls.

rules:
  - id: "no-rm-rf"
    match:
      tool: shell
      command_pattern: "rm\\\\s+-rf"
    action: deny

  - id: "no-path-traversal"
    match:
      tool: shell
      command_pattern: "\\\\.\\\\./"
    action: deny

  - id: "warn-env-access"
    match:
      tool: file_read
      file_pattern: "\\\\.env"
    action: warn

  - id: "warn-env-edit"
    match:
      tool: file_edit
      file_pattern: "\\\\.env"
    action: warn

  - id: "warn-mcp"
    match:
      tool: mcp_call
    action: warn
`,
    // ── Strict: allowlist-only ──────────────────────────────────────────────────
    strict: `# Oculi local policy — strict (allowlist-only)
#
# Denies everything by default, then explicitly allows safe operations.
# Precedence: deny > warn > allow — the catch-all deny only applies
# when no higher-precedence allow rule matches for the specific tool.

rules:
  # Catch-all: deny any tool not explicitly allowed below
  - id: "deny-all"
    match:
      tool: shell
    action: deny

  - id: "deny-all-mcp"
    match:
      tool: mcp_call
    action: deny

  # Allow file reads (but warn on .env)
  - id: "allow-file-read"
    match:
      tool: file_read
    action: allow

  - id: "warn-env-read"
    match:
      tool: file_read
      file_pattern: "\\\\.env"
    action: warn

  # Allow file edits (but warn on .env)
  - id: "allow-file-edit"
    match:
      tool: file_edit
    action: allow

  - id: "deny-env-edit"
    match:
      tool: file_edit
      file_pattern: "\\\\.env"
    action: deny

  # Allow safe shell commands only
  - id: "allow-safe-shell"
    match:
      tool: shell
      command_pattern: "^(ls|cat|head|tail|wc|grep|find|echo|pwd|date|git\\\\s+(status|log|diff|branch|show))\\\\b"
    action: allow
`,
};
//# sourceMappingURL=local-policy-templates.js.map