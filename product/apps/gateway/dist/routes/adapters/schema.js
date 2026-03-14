"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OculiEventSchema = void 0;
const zod_1 = require("zod");
/**
 * OculiEvent — canonical hook event schema (schema_version: '1')
 *
 * All IDE hook adapters (Claude Code, Cursor, Windsurf, …) normalize their
 * raw wire payloads to this shape before the gateway processes them.
 *
 * snake_case throughout to match the raw wire formats as closely as possible.
 */
exports.OculiEventSchema = zod_1.z.object({
    /** Increment when the schema has breaking changes. */
    schema_version: zod_1.z.literal('1'),
    // ── Source identity ────────────────────────────────────────────────────────
    /** Which IDE emitted the hook: 'claude-code' | 'cursor' | 'windsurf' | … */
    ide_source: zod_1.z.string().min(1),
    /** Actor name. Defaults to ide_source when no JWT is present. */
    actor: zod_1.z.string().min(1),
    /** Organization ID. Defaults to 'default'. */
    org_id: zod_1.z.string().default('default'),
    // ── Hook identity ──────────────────────────────────────────────────────────
    /** Raw event name from the IDE, preserved verbatim (e.g. 'PreToolUse', 'beforeShellExecution'). */
    hook_event_name: zod_1.z.string().min(1),
    /**
     * Lifecycle phase:
     *   pre      — hook fires before tool execution; enforcement gate
     *   post     — hook fires after tool execution; telemetry only
     *   complete — agent session ended (Cursor 'stop' event); telemetry only
     */
    phase: zod_1.z.enum(['pre', 'post', 'complete']),
    // ── Session / trace ────────────────────────────────────────────────────────
    /** Session identifier. Claude Code: session_id. Cursor: conversation_id. */
    session_id: zod_1.z.string().min(1),
    /** Sub-session trace. Cursor: generation_id. */
    trace_id: zod_1.z.string().optional(),
    // ── Tool invocation (absent for 'stop' / 'complete' events) ───────────────
    /** Normalized tool name. Absent for stop/complete events. */
    tool: zod_1.z.string().optional(),
    /** Tool arguments as a key-value map. */
    tool_args: zod_1.z.record(zod_1.z.unknown()).optional(),
    /** Tool result (post-phase only). */
    tool_result: zod_1.z.unknown().optional(),
    // ── Resource context ───────────────────────────────────────────────────────
    /** File path for file-oriented operations (readFile, writeFile). */
    file_path: zod_1.z.string().optional(),
    /** Shell command string for shell execution events. */
    shell_command: zod_1.z.string().optional(),
    /** MCP server name for MCP tool calls. */
    mcp_server: zod_1.z.string().optional(),
    /** Workspace root directories (Cursor). */
    workspace_roots: zod_1.z.array(zod_1.z.string()).optional(),
    /** Current working directory (Claude Code). */
    cwd: zod_1.z.string().optional(),
    // ── Timing ─────────────────────────────────────────────────────────────────
    /** ISO 8601 timestamp; set by the adapter at normalize time. */
    timestamp: zod_1.z.string().min(1),
    /** Tool execution duration in milliseconds (post-phase only). */
    duration_ms: zod_1.z.number().optional(),
    // ── Status ─────────────────────────────────────────────────────────────────
    /** Error message if the tool failed. */
    error: zod_1.z.string().optional(),
    // ── Normalised cross-IDE context ───────────────────────────────────────────
    /** Workspace and identity context, unified from IDE-specific fields. */
    context: zod_1.z.object({
        /** Workspace root (Claude Code: cwd; Cursor: workspace_roots[0]). */
        workspace: zod_1.z.string().optional(),
        /** IDE conversation identifier (Cursor: conversation_id). */
        conversation_id: zod_1.z.string().optional(),
    }).optional(),
    // ── Normalised action payload ──────────────────────────────────────────────
    /** Normalised action data for the tool invocation. */
    action: zod_1.z.object({
        /** Shell command for shell execution events (tool: 'shell'). */
        command: zod_1.z.string().optional(),
        /** SHA-256 prefix (16 hex chars) of file content for read/edit events. */
        content_hash: zod_1.z.string().optional(),
    }).optional(),
    // ── Raw payload ────────────────────────────────────────────────────────────
    /** Original wire payload, preserved verbatim for audit and debugging. */
    raw_payload: zod_1.z.record(zod_1.z.unknown()),
});
//# sourceMappingURL=schema.js.map