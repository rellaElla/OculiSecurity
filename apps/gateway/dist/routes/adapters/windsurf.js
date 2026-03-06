"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detect = detect;
exports.normalize = normalize;
exports.formatAllow = formatAllow;
exports.formatDeny = formatDeny;
exports.denyStatusCode = denyStatusCode;
function detect(body) {
    return (typeof body.agent_action_name === 'string' &&
        body.agent_action_name.startsWith('pre_mcp_tool_use') ||
        (typeof body.agent_action_name === 'string' &&
            body.agent_action_name.startsWith('post_mcp_tool_use')));
}
function normalize(body) {
    const actionName = body.agent_action_name;
    const phase = actionName.startsWith('pre_') ? 'pre' : 'post';
    const toolInfo = body.tool_info;
    const tool = toolInfo
        ? `${toolInfo.mcp_server_name}__${toolInfo.mcp_tool_name}`
        : undefined;
    const mcp_server = toolInfo?.mcp_server_name;
    return {
        schema_version: '1',
        ide_source: 'windsurf',
        actor: 'windsurf',
        org_id: 'default',
        hook_event_name: actionName,
        phase,
        session_id: body.trajectory_id ?? 'windsurf-unknown',
        trace_id: body.execution_id,
        tool,
        tool_args: toolInfo?.mcp_tool_arguments,
        mcp_server,
        timestamp: body.timestamp ?? new Date().toISOString(),
        raw_payload: body,
    };
}
// Windsurf allow: HTTP 200, no specific body needed
function formatAllow() {
    return JSON.stringify({ status: 'allow' });
}
// Windsurf block: caller sends HTTP 403 — body is informational only
function formatDeny(reason) {
    return JSON.stringify({ status: 'deny', reason });
}
function denyStatusCode() {
    return 403; // Windsurf uses HTTP 403 to signal a block
}
//# sourceMappingURL=windsurf.js.map