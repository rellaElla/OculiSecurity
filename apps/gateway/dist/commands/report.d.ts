import { TelemetryLogEntry } from '../services/telemetry-log';
export interface ReportData {
    period: {
        from: string;
        to: string;
        hours: number;
    };
    total: number;
    by_phase: Record<string, number>;
    by_tool: Array<{
        tool: string;
        count: number;
    }>;
    by_ide: Array<{
        ide: string;
        count: number;
        percent: number;
    }>;
    violations: Array<{
        timestamp: string;
        decision: string;
        tool: string;
        detail: string;
        rule_ids: string[];
    }>;
}
export declare function buildReport(entries: TelemetryLogEntry[], hours: number): ReportData;
export declare function formatReport(report: ReportData): string;
export interface ReportOptions {
    json: boolean;
    hours: number;
}
export declare function runReport(opts: ReportOptions): void;
