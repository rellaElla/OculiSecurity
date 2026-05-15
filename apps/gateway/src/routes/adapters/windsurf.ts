import { OculiEvent } from './schema';

/**
 * Adapter for Windsurf Cascade pre_mcp_tool_use / post_mcp_tool_use hook payloads.
 *
 * Wire format:
 *   { agent_action_name, tool_info: { mcp_server_name, mcp_tool_name, mcp_tool_arguments },
 *     trajectory_id, execution_id, timestamp }
 *
 * Block response: HTTP 403 (no specific JSON body required).
 */

interface WindsurfToolInfo {
  mcp_server_name: string;
  mcp_tool_name: string;
  mcp_tool_arguments?: Record<string, unknown>;
}

export function detect(body: Record<string, unknown>): boolean {
  return (
    typeof body.agent_action_name === 'string' &&
    body.agent_action_name.startsWith('pre_mcp_tool_use') ||
    (typeof body.agent_action_name === 'string' &&
      body.agent_action_name.startsWith('post_mcp_tool_use'))
  );
}

export function normalize(body: Record<string, unknown>): OculiEvent {
  const actionName = body.agent_action_name as string;
  const phase: 'pre' | 'post' = actionName.startsWith('pre_') ? 'pre' : 'post';
  const toolInfo = body.tool_info as WindsurfToolInfo | undefined;

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
    session_id: (body.trajectory_id as string | undefined) ?? 'windsurf-unknown',
    trace_id: body.execution_id as string | undefined,
    tool,
    tool_args: toolInfo?.mcp_tool_arguments,
    mcp_server,
    timestamp: (body.timestamp as string | undefined) ?? new Date().toISOString(),
    raw_payload: body,
  };
}

// Windsurf allow: HTTP 200, no specific body needed
export function formatAllow(_event: OculiEvent): string {
  return JSON.stringify({ status: 'allow' });
}

// Windsurf block: caller sends HTTP 403 — body is informational only
export function formatDeny(reason: string, _event: OculiEvent): string {
  return JSON.stringify({ status: 'deny', reason });
}

export function denyStatusCode(): number {
  return 403; // Windsurf uses HTTP 403 to signal a block
}
