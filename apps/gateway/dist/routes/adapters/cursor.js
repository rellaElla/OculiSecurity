"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCursorEvent = parseCursorEvent;
exports.detect = detect;
exports.normalize = normalize;
exports.formatAllow = formatAllow;
exports.formatDeny = formatDeny;
exports.denyStatusCode = denyStatusCode;
const crypto_1 = require("crypto");
/**
 * Adapter for Cursor hook payloads.
 *
 * Wire formats (all share conversation_id + generation_id + hook_event_name):
 *
 *   beforeShellExecution:  { conversation_id, generation_id, hook_event_name, content, workspace_roots }
 *   afterFileEdit:         { conversation_id, generation_id, hook_event_name, file_path, content, workspace_roots }
 *   beforeReadFile:        { conversation_id, generation_id, hook_event_name, file_path, content, workspace_roots }
 *   beforeMCPExecution:    { conversation_id, generation_id, hook_event_name, mcp_server, mcp_tool, workspace_roots }
 *   afterMCPExecution:     { conversation_id, generation_id, hook_event_name, mcp_server, mcp_tool, workspace_roots }
 *   stop:                  { conversation_id, generation_id, hook_event_name, workspace_roots }
 *
 * Detection: conversation_id + generation_id (both strings).
 *
 * Block response (written to stdout):
 *   { "permissionDecision": "deny", "permissionDecisionReason": "..." }
 */
/** 16-hex-char SHA-256 prefix — enough to detect duplicates, not enough to reconstruct content. */
function sha256prefix(content) {
    return (0, crypto_1.createHash)('sha256').update(content).digest('hex').slice(0, 16);
}
/**
 * Parse a Cursor hook event from raw stdin JSON and the hook event name.
 *
 * This is the single source of truth for all Cursor payload parsing.
 * The HTTP adapter's normalize() delegates here.
 *
 * @param stdin     Raw JSON string sent to the hook's stdin by Cursor.
 * @param hookEvent Hook event name (e.g. 'beforeShellExecution', 'stop').
 */
function parseCursorEvent(stdin, hookEvent) {
    const body = JSON.parse(stdin);
    let phase;
    if (hookEvent === 'stop') {
        phase = 'complete';
    }
    else if (hookEvent.startsWith('after')) {
        phase = 'post';
    }
    else {
        phase = 'pre';
    }
    let tool;
    let tool_args;
    let tool_result;
    let file_path;
    let shell_command;
    let mcp_server;
    let action;
    switch (hookEvent) {
        case 'beforeShellExecution':
            tool = 'shell';
            shell_command = body.content;
            tool_args = { command: body.content };
            if (body.content)
                action = { command: body.content };
            break;
        case 'beforeReadFile':
            tool = 'file_read';
            file_path = body.file_path;
            tool_args = { path: body.file_path };
            if (body.content)
                action = { content_hash: sha256prefix(body.content) };
            break;
        case 'afterFileEdit':
            tool = 'file_edit';
            file_path = body.file_path;
            tool_result = { path: body.file_path };
            if (body.content)
                action = { content_hash: sha256prefix(body.content) };
            break;
        case 'beforeMCPExecution':
        case 'afterMCPExecution':
            tool = 'mcp_call';
            mcp_server = body.mcp_server;
            tool_args = { mcp_tool: body.mcp_tool, mcp_server: body.mcp_server };
            break;
        case 'stop':
            tool = 'session_stop';
            break;
    }
    const workspace_roots = Array.isArray(body.workspace_roots)
        ? body.workspace_roots
        : undefined;
    const conversationId = body.conversation_id;
    const workspace = workspace_roots?.[0];
    return {
        schema_version: '1',
        ide_source: 'cursor',
        actor: 'cursor',
        org_id: 'default',
        hook_event_name: hookEvent,
        phase,
        session_id: conversationId,
        trace_id: body.generation_id,
        tool,
        tool_args,
        tool_result,
        file_path,
        shell_command,
        mcp_server,
        workspace_roots,
        context: { workspace, conversation_id: conversationId },
        action,
        timestamp: new Date().toISOString(),
        raw_payload: body,
    };
}
/** Detect whether a parsed request body came from Cursor. */
function detect(body) {
    return (typeof body.conversation_id === 'string' &&
        typeof body.generation_id === 'string');
}
/**
 * Normalize a pre-parsed HTTP request body into an OculiEvent.
 * Delegates all parsing logic to parseCursorEvent.
 */
function normalize(body) {
    const hookEvent = body.hook_event_name ?? 'unknown';
    return parseCursorEvent(JSON.stringify(body), hookEvent);
}
function formatAllow() {
    return JSON.stringify({ permissionDecision: 'allow' });
}
function formatDeny(reason) {
    return JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason });
}
function denyStatusCode() {
    return 200; // Cursor reads permissionDecision from the JSON body
}
//# sourceMappingURL=cursor.js.map