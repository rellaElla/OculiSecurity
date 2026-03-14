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
export declare function formatAllow(): string;
export declare function formatDeny(reason: string): string;
export declare function denyStatusCode(): number;
//# sourceMappingURL=claude-code.d.ts.map