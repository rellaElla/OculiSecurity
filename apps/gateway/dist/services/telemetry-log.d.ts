import { OculiEvent } from '../routes/adapters/schema';
export interface TelemetryLogEntry {
    schema_version: string;
    ide_source: string;
    actor: string;
    org_id: string;
    hook_event_name: string;
    phase: string;
    session_id: string;
    trace_id?: string;
    tool?: string;
    tool_args?: Record<string, unknown>;
    file_path?: string;
    shell_command?: string;
    mcp_server?: string;
    timestamp: string;
    duration_ms?: number;
    error?: string;
    context?: {
        workspace?: string;
        conversation_id?: string;
    };
    action?: {
        command?: string;
        content_hash?: string;
    };
    policy_decision: 'allow' | 'warn' | 'deny';
    policy_rule_ids: string[];
}
/**
 * Find the nearest `.oculi/` directory by walking up from `startDir`.
 * If none is found, creates `.oculi/` in startDir (or cwd).
 */
export declare function findOrCreateOculiDir(startDir?: string): string;
/**
 * Find existing `.oculi/telemetry.jsonl` by walking up. Returns null if none exists.
 */
export declare function findTelemetryLog(startDir?: string): string | null;
/**
 * Convert an OculiEvent + policy decision into a log entry (omitting raw_payload).
 */
export declare function eventToLogEntry(event: OculiEvent, decision: 'allow' | 'warn' | 'deny', ruleIds?: string[]): TelemetryLogEntry;
/**
 * Append a telemetry log entry to `.oculi/telemetry.jsonl`.
 * Handles rotation automatically.
 */
export declare function appendTelemetry(entry: TelemetryLogEntry, oculiDir?: string): string;
export interface ReadOptions {
    since?: Date;
    filter?: 'allow' | 'warn' | 'deny';
}
/**
 * Read telemetry log entries from a file with optional filtering.
 */
export declare function readTelemetryLines(logPath: string, opts?: ReadOptions): TelemetryLogEntry[];
/**
 * Get the path to the telemetry log file (creating .oculi/ dir if needed).
 */
export declare function getTelemetryLogPath(oculiDir?: string): string;
//# sourceMappingURL=telemetry-log.d.ts.map