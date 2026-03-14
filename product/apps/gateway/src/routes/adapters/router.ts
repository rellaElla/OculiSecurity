import { OculiEvent } from './schema';
import { HookAdapter } from './index';
import * as ClaudeCode from './claude-code';
import * as Cursor from './cursor';
import * as Windsurf from './windsurf';

/**
 * Central adapter registry.
 * Add new IDE adapters here — nothing else needs to change.
 */
const ADAPTER_REGISTRY: Record<string, HookAdapter> = {
  'claude-code': ClaudeCode,
  'cursor': Cursor,
  'windsurf': Windsurf,
};

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
export function route(
  body: Record<string, unknown>,
  explicit?: string,
): RouteResult | null {
  // Strategy 1 — explicit adapter by name
  if (explicit) {
    const adapter = ADAPTER_REGISTRY[explicit.toLowerCase()];
    if (adapter) {
      return { adapterName: explicit.toLowerCase(), adapter, event: adapter.normalize(body) };
    }
  }

  // Strategy 2 — auto-detect from payload fields
  for (const [name, adapter] of Object.entries(ADAPTER_REGISTRY)) {
    if (adapter.detect(body)) {
      return { adapterName: name, adapter, event: adapter.normalize(body) };
    }
  }

  return null;
}

/**
 * Route a raw JSON string (hook stdin) to the correct adapter.
 * Parses stdin and delegates to route().
 *
 * @param stdin         Raw JSON string from the IDE hook.
 * @param explicitName  Optional adapter name — skips auto-detection when provided.
 */
export function routeStdin(
  stdin: string,
  explicitName?: string,
): RouteResult | null {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(stdin) as Record<string, unknown>;
  } catch {
    return null;
  }
  return route(body, explicitName);
}

/** Returns the canonical names of all registered adapters. */
export function registeredAdapters(): string[] {
  return Object.keys(ADAPTER_REGISTRY);
}
