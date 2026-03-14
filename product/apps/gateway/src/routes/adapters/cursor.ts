import { createHash } from 'crypto';
import { OculiEvent } from './schema';

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
function sha256prefix(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
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
export function parseCursorEvent(stdin: string, hookEvent: string): OculiEvent {
  const body = JSON.parse(stdin) as Record<string, unknown>;

  let phase: 'pre' | 'post' | 'complete';
  if (hookEvent === 'stop') {
    phase = 'complete';
  } else if (hookEvent.startsWith('after')) {
    phase = 'post';
  } else {
    phase = 'pre';
  }

  let tool: string | undefined;
  let tool_args: Record<string, unknown> | undefined;
  let tool_result: unknown;
  let file_path: string | undefined;
  let shell_command: string | undefined;
  let mcp_server: string | undefined;
  let action: { command?: string; content_hash?: string } | undefined;

  switch (hookEvent) {
    case 'beforeShellExecution':
      tool = 'shell';
      shell_command = body.content as string | undefined;
      tool_args = { command: body.content };
      if (body.content) action = { command: body.content as string };
      break;

    case 'beforeReadFile':
      tool = 'file_read';
      file_path = body.file_path as string | undefined;
      tool_args = { path: body.file_path };
      if (body.content) action = { content_hash: sha256prefix(body.content as string) };
      break;

    case 'afterFileEdit':
      tool = 'file_edit';
      file_path = body.file_path as string | undefined;
      tool_result = { path: body.file_path };
      if (body.content) action = { content_hash: sha256prefix(body.content as string) };
      break;

    case 'beforeMCPExecution':
    case 'afterMCPExecution':
      tool = 'mcp_call';
      mcp_server = body.mcp_server as string | undefined;
      tool_args = { mcp_tool: body.mcp_tool, mcp_server: body.mcp_server };
      break;

    case 'stop':
      tool = 'session_stop';
      break;
  }

  const workspace_roots = Array.isArray(body.workspace_roots)
    ? (body.workspace_roots as string[])
    : undefined;

  const conversationId = body.conversation_id as string;
  const workspace = workspace_roots?.[0];

  return {
    schema_version: '1',
    ide_source: 'cursor',
    actor: 'cursor',
    org_id: 'default',
    hook_event_name: hookEvent,
    phase,
    session_id: conversationId,
    trace_id: body.generation_id as string,
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
export function detect(body: Record<string, unknown>): boolean {
  return (
    typeof body.conversation_id === 'string' &&
    typeof body.generation_id === 'string'
  );
}

/**
 * Normalize a pre-parsed HTTP request body into an OculiEvent.
 * Delegates all parsing logic to parseCursorEvent.
 */
export function normalize(body: Record<string, unknown>): OculiEvent {
  const hookEvent = (body.hook_event_name as string | undefined) ?? 'unknown';
  return parseCursorEvent(JSON.stringify(body), hookEvent);
}

export function formatAllow(): string {
  return JSON.stringify({ permissionDecision: 'allow' });
}

export function formatDeny(reason: string): string {
  return JSON.stringify({ permissionDecision: 'deny', permissionDecisionReason: reason });
}

export function denyStatusCode(): number {
  return 200; // Cursor reads permissionDecision from the JSON body
}
