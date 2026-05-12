import { OculiEvent } from './schema';
import { HookAdapter } from './index';
export interface RouteResult {
    /** Canonical adapter name ('claude-code', 'cursor', 'windsurf'). */
    adapterName: string;
    /** The adapter that handled this payload. */
    adapter: HookAdapter;
    /** Normalised event — the only thing the policy engine and telemetry see. */
    event: OculiEvent;
}
/**
 * Route a parsed hook payload to the correct adapter.
 *
 * Priority:
 *   1. Explicit — if `explicit` names a known adapter, use it immediately
 *      without inspecting the payload.  Zero detection overhead, deterministic.
 *   2. Auto-detect — iterate the registry until an adapter's detect() matches.
 *
 * Returns null when no adapter matches.
 */
export declare function route(body: Record<string, unknown>, explicit?: string): RouteResult | null;
/**
 * Route a raw JSON string (hook stdin) to the correct adapter.
 * Parses stdin and delegates to route().
 *
 * @param stdin         Raw JSON string from the IDE hook.
 * @param explicitName  Optional adapter name — skips auto-detection when provided.
 */
export declare function routeStdin(stdin: string, explicitName?: string): RouteResult | null;
/** Returns the canonical names of all registered adapters. */
export declare function registeredAdapters(): string[];
