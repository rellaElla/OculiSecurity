import { OculiEvent } from './schema';
/**
 * Parse a Cursor hook event from raw stdin JSON and the hook event name.
 *
 * This is the single source of truth for all Cursor payload parsing.
 * The HTTP adapter's normalize() delegates here.
 *
 * @param stdin     Raw JSON string sent to the hook's stdin by Cursor.
 * @param hookEvent Hook event name (e.g. 'beforeShellExecution', 'stop').
 */
export declare function parseCursorEvent(stdin: string, hookEvent: string): OculiEvent;
/** Detect whether a parsed request body came from Cursor. */
export declare function detect(body: Record<string, unknown>): boolean;
/**
 * Normalize a pre-parsed HTTP request body into an OculiEvent.
 * Delegates all parsing logic to parseCursorEvent.
 */
export declare function normalize(body: Record<string, unknown>): OculiEvent;
export declare function formatAllow(): string;
export declare function formatDeny(reason: string): string;
export declare function denyStatusCode(): number;
//# sourceMappingURL=cursor.d.ts.map