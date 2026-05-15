import { OculiEvent } from './schema';
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
export declare function parseClaudeCodeEvent(stdin: string, hookEvent: string): OculiEvent;
/**
 * Detect whether a parsed request body came from Claude Code.
 * Detection key: tool_name + session_id (Cursor uses conversation_id instead).
 */
export declare function detect(body: Record<string, unknown>): boolean;
/**
 * Normalize a pre-parsed HTTP request body into an OculiEvent.
 * Delegates all parsing logic to parseClaudeCodeEvent.
 */
export declare function normalize(body: Record<string, unknown>): OculiEvent;
/**
 * Output shapes follow the Claude Code hook spec at
 * https://code.claude.com/docs/en/hooks.
 *
 *  - PreToolUse: blocking via `hookSpecificOutput.permissionDecision`.
 *  - PostToolUse: cannot block the tool (already ran); top-level `decision: "block"`
 *    only prevents Claude from continuing to the next turn.
 *  - Stop / others: empty `{}` = allow / default behavior. We never block Stop.
 *
 * All shapes are emitted with exit code 0; Claude Code ignores stdout on exit 2.
 */
export declare function formatAllow(_event: OculiEvent): string;
export declare function formatDeny(reason: string, event: OculiEvent): string;
export declare function formatWarn(reason: string, event: OculiEvent): string;
export declare function denyStatusCode(): number;
