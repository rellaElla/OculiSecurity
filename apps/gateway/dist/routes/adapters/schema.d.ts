import { z } from 'zod';
/**
 * OculiEvent — canonical hook event schema (schema_version: '1')
 *
 * All IDE hook adapters (Claude Code, Cursor, Windsurf, …) normalize their
 * raw wire payloads to this shape before the gateway processes them.
 *
 * snake_case throughout to match the raw wire formats as closely as possible.
 */
export declare const OculiEventSchema: z.ZodObject<{
    /** Increment when the schema has breaking changes. */
    schema_version: z.ZodLiteral<"1">;
    /** Which IDE emitted the hook: 'claude-code' | 'cursor' | 'windsurf' | … */
    ide_source: z.ZodString;
    /** Actor name. Defaults to ide_source when no JWT is present. */
    actor: z.ZodString;
    /** Organization ID. Defaults to 'default'. */
    org_id: z.ZodDefault<z.ZodString>;
    /** Raw event name from the IDE, preserved verbatim (e.g. 'PreToolUse', 'beforeShellExecution'). */
    hook_event_name: z.ZodString;
    /**
     * Lifecycle phase:
     *   pre      — hook fires before tool execution; enforcement gate
     *   post     — hook fires after tool execution; telemetry only
     *   complete — agent session ended (Cursor 'stop' event); telemetry only
     */
    phase: z.ZodEnum<["pre", "post", "complete"]>;
    /** Session identifier. Claude Code: session_id. Cursor: conversation_id. */
    session_id: z.ZodString;
    /** Sub-session trace. Cursor: generation_id. */
    trace_id: z.ZodOptional<z.ZodString>;
    /** Normalized tool name. Absent for stop/complete events. */
    tool: z.ZodOptional<z.ZodString>;
    /** Tool arguments as a key-value map. */
    tool_args: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    /** Tool result (post-phase only). */
    tool_result: z.ZodOptional<z.ZodUnknown>;
    /** File path for file-oriented operations (readFile, writeFile). */
    file_path: z.ZodOptional<z.ZodString>;
    /** Shell command string for shell execution events. */
    shell_command: z.ZodOptional<z.ZodString>;
    /** MCP server name for MCP tool calls. */
    mcp_server: z.ZodOptional<z.ZodString>;
    /** Workspace root directories (Cursor). */
    workspace_roots: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    /** Current working directory (Claude Code). */
    cwd: z.ZodOptional<z.ZodString>;
    /** ISO 8601 timestamp; set by the adapter at normalize time. */
    timestamp: z.ZodString;
    /** Tool execution duration in milliseconds (post-phase only). */
    duration_ms: z.ZodOptional<z.ZodNumber>;
    /** Error message if the tool failed. */
    error: z.ZodOptional<z.ZodString>;
    /** Workspace and identity context, unified from IDE-specific fields. */
    context: z.ZodOptional<z.ZodObject<{
        /** Workspace root (Claude Code: cwd; Cursor: workspace_roots[0]). */
        workspace: z.ZodOptional<z.ZodString>;
        /** IDE conversation identifier (Cursor: conversation_id). */
        conversation_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        workspace?: string | undefined;
        conversation_id?: string | undefined;
    }, {
        workspace?: string | undefined;
        conversation_id?: string | undefined;
    }>>;
    /** Normalised action data for the tool invocation. */
    action: z.ZodOptional<z.ZodObject<{
        /** Shell command for shell execution events (tool: 'shell'). */
        command: z.ZodOptional<z.ZodString>;
        /** SHA-256 prefix (16 hex chars) of file content for read/edit events. */
        content_hash: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        command?: string | undefined;
        content_hash?: string | undefined;
    }, {
        command?: string | undefined;
        content_hash?: string | undefined;
    }>>;
    /** Original wire payload, preserved verbatim for audit and debugging. */
    raw_payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    schema_version: "1";
    ide_source: string;
    actor: string;
    org_id: string;
    hook_event_name: string;
    phase: "pre" | "post" | "complete";
    session_id: string;
    timestamp: string;
    raw_payload: Record<string, unknown>;
    trace_id?: string | undefined;
    tool?: string | undefined;
    tool_args?: Record<string, unknown> | undefined;
    tool_result?: unknown;
    file_path?: string | undefined;
    shell_command?: string | undefined;
    mcp_server?: string | undefined;
    workspace_roots?: string[] | undefined;
    cwd?: string | undefined;
    duration_ms?: number | undefined;
    error?: string | undefined;
    context?: {
        workspace?: string | undefined;
        conversation_id?: string | undefined;
    } | undefined;
    action?: {
        command?: string | undefined;
        content_hash?: string | undefined;
    } | undefined;
}, {
    schema_version: "1";
    ide_source: string;
    actor: string;
    hook_event_name: string;
    phase: "pre" | "post" | "complete";
    session_id: string;
    timestamp: string;
    raw_payload: Record<string, unknown>;
    org_id?: string | undefined;
    trace_id?: string | undefined;
    tool?: string | undefined;
    tool_args?: Record<string, unknown> | undefined;
    tool_result?: unknown;
    file_path?: string | undefined;
    shell_command?: string | undefined;
    mcp_server?: string | undefined;
    workspace_roots?: string[] | undefined;
    cwd?: string | undefined;
    duration_ms?: number | undefined;
    error?: string | undefined;
    context?: {
        workspace?: string | undefined;
        conversation_id?: string | undefined;
    } | undefined;
    action?: {
        command?: string | undefined;
        content_hash?: string | undefined;
    } | undefined;
}>;
export type OculiEvent = z.infer<typeof OculiEventSchema>;
//# sourceMappingURL=schema.d.ts.map