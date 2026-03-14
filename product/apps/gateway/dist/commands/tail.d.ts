import { TelemetryLogEntry } from '../services/telemetry-log';
export declare function formatEntry(entry: TelemetryLogEntry, colorEnabled: boolean): string;
export interface TailOptions {
    filter?: 'allow' | 'warn' | 'deny';
    noColor?: boolean;
}
export declare function runTail(opts: TailOptions): void;
//# sourceMappingURL=tail.d.ts.map