import { OculiEvent } from './schema';
export interface HookAdapter {
    detect(body: Record<string, unknown>): boolean;
    normalize(body: Record<string, unknown>): OculiEvent;
    formatAllow(): string;
    formatDeny(reason: string): string;
    /** HTTP status code for deny responses. Most adapters use 200 (body carries the decision); Windsurf uses 403. */
    denyStatusCode(): number;
}
/**
 * Find the first adapter that recognises the given payload.
 * Returns null if no adapter matches (unknown source).
 */
export declare function detectAdapter(body: Record<string, unknown>): HookAdapter | null;
