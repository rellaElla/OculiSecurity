/**
 * Starter policy template for `oculi init`.
 *
 * Stored as a raw YAML string (not an object) so we can include comments
 * that explain the format to the user.
 */

export const TEMPLATE_NAMES = ['standard'] as const;
export type TemplateName = (typeof TEMPLATE_NAMES)[number];

export const templates: Record<TemplateName, string> = {
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
};
