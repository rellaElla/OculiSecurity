import { AuditRecord } from '../types';
import { AppConfig } from '../config';
export declare class AuditService {
    private readonly db;
    readonly storeFullArgs: boolean;
    constructor(config: AppConfig);
    private initialize;
    /** Read the persisted byte offset for an absolute jsonl path. Zero when missing. */
    private getReplayOffset;
    private setReplayOffset;
    /** SHA-256 hex prefix of JSON-serialised data */
    hash(data: unknown): string;
    log(record: Omit<AuditRecord, 'id'>): void;
    /** Read recent audit records (descending by timestamp) */
    query(limit?: number, offset?: number): AuditRecord[];
    /** Count total rows */
    count(): number;
    /** Summary stats for the last N hours */
    summary(hours?: number): {
        totalCalls: number;
        deniedCalls: number;
        avgLatencyMs: number;
        rateLimitViolations: number;
    };
    /** Top N tools by total call count */
    topTools(limit?: number): Array<{
        tool: string;
        count: number;
    }>;
    /** Top N denied tools */
    topDeniedTools(limit?: number): Array<{
        tool: string;
        count: number;
    }>;
    /** Top N actors by activity */
    topActors(limit?: number): Array<{
        actor: string;
        count: number;
    }>;
    /** Allowed vs denied breakdown */
    decisionBreakdown(): {
        allowed: number;
        denied: number;
    };
    /** Time-series: calls grouped into fixed-width buckets */
    timeSeries(hours?: number, bucketMinutes?: number): Array<{
        bucket: string;
        count: number;
    }>;
    /** Search audit records with optional filters */
    search(opts: {
        q?: string;
        decision?: string;
        from?: string;
        to?: string;
        limit?: number;
        offset?: number;
    }): {
        total: number;
        results: AuditRecord[];
    };
    private static readonly ALLOWED_GROUP_BY_FIELDS;
    /** Group-by aggregation with optional WHERE filters */
    aggregate(opts: {
        groupBy: string[];
        q?: string;
        decision?: string;
        from?: string;
        to?: string;
        limit?: number;
    }): {
        groupBy: string[];
        results: Array<Record<string, string | number>>;
    };
    /**
     * Backfill audit_logs from `~/.oculi/telemetry.jsonl` (or whichever path is
     * passed). Resumes from the persisted byte offset, so re-running serve does
     * not double-count. Returns counts for observability.
     *
     * The CLI client always appends to telemetry.jsonl; the gateway only writes
     * to sqlite. Without this replay, events generated while `oculi serve` was
     * NOT running are invisible to the dashboard. See plan file for the full
     * divergence analysis.
     */
    replayFromTelemetry(jsonlPath: string): {
        inserted: number;
        skipped: number;
        newOffset: number;
        rotated: boolean;
    };
    close(): void;
}
