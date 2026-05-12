"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseClaudeCodeEvent = parseClaudeCodeEvent;
exports.detect = detect;
exports.normalize = normalize;
exports.formatAllow = formatAllow;
exports.formatDeny = formatDeny;
exports.denyStatusCode = denyStatusCode;
/**
 * Adapter for Claude Code PreToolUse / PostToolUse hook payloads.
 *
 * Wire format (sent to the hook's stdin by Claude Code):
 *   { hook_event_name, tool_name, tool_input, tool_response, session_id, cwd, ... }
 *
 * Block response (written to stdout):
 *   { "decision": "block", "reason": "..." }
 */
/**
 * Normalize Claude Code tool names to standard cross-IDE identifiers.
 * Unmatched tool names pass through unchanged (preserving specificity).
 */
const TOOL_NORMALIZATIONS = {
    Bash: 'shell',
    Read: 'file_read',
    Write: 'file_edit',
    Edit: 'file_edit',
    MultiEdit: 'file_edit',
};
/**
 * Parse a Claude Code hook event from raw stdin JSON and the hook event name.
 *
 * This is the single source of truth for all Claude Code payload parsing.
 * The HTTP adapter's normalize() delegates here so that nothing outside this
 * module ever needs to understand Claude Code's wire format.
 *
 * @param stdin     Raw JSON string sent to the hook's stdin by Claude Code.
 * @param hookEvent Hook event name from the Claude Code runtime
 *                  (e.g. 'PreToolUse', 'PostToolUse').
 */
function parseClaudeCodeEvent(stdin, hookEvent) {
    const body = JSON.parse(stdin);
    const phase = hookEvent === 'PreToolUse' ? 'pre' : 'post';
    const rawTool = body.tool_name;
    const tool = TOOL_NORMALIZATIONS[rawTool] ?? rawTool;
    const toolInput = body.tool_input;
    const cwd = body.cwd;
    // For shell tools, populate shell_command and action.command from tool_input
    let shell_command;
    let action;
    if (tool === 'shell' && toolInput?.command) {
        shell_command = String(toolInput.command);
        action = { command: shell_command };
    }
    return {
        schema_version: '1',
        ide_source: 'claude-code',
        actor: 'claude-code',
        org_id: 'default',
        hook_event_name: hookEvent,
        phase,
        session_id: body.session_id,
        tool,
        tool_args: toolInput,
        tool_result: body.tool_response,
        shell_command,
        cwd,
        context: cwd ? { workspace: cwd } : undefined,
        action,
        timestamp: new Date().toISOString(),
        raw_payload: body,
    };
}
/**
 * Detect whether a parsed request body came from Claude Code.
 * Detection key: tool_name + session_id (Cursor uses conversation_id instead).
 */
function detect(body) {
    return (typeof body.tool_name === 'string' &&
        typeof body.session_id === 'string');
}
/**
 * Normalize a pre-parsed HTTP request body into an OculiEvent.
 * Delegates all parsing logic to parseClaudeCodeEvent.
 */
function normalize(body) {
    const hookEvent = body.hook_event_name ?? 'PostToolUse';
    return parseClaudeCodeEvent(JSON.stringify(body), hookEvent);
}
function formatAllow() {
    return JSON.stringify({ decision: 'allow' });
}
function formatDeny(reason) {
    return JSON.stringify({ decision: 'block', reason });
}
function denyStatusCode() {
    return 200; // Claude Code reads the JSON body; HTTP status is always 200
}
