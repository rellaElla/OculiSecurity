import { OculiEvent } from './schema';
import * as ClaudeCode from './claude-code';
import * as Cursor from './cursor';
import * as Windsurf from './windsurf';

export interface HookAdapter {
  detect(body: Record<string, unknown>): boolean;
  normalize(body: Record<string, unknown>): OculiEvent;
  formatAllow(event: OculiEvent): string;
  formatDeny(reason: string, event: OculiEvent): string;
  /** Non-blocking advisory output. Optional: only adapters whose hook protocol distinguishes warn from allow need to implement this. */
  formatWarn?(reason: string, event: OculiEvent): string;
  /** HTTP status code for deny responses. Most adapters use 200 (body carries the decision); Windsurf uses 403. */
  denyStatusCode(): number;
}

// Order matters: most specific first to avoid false positives
const ADAPTERS: HookAdapter[] = [
  ClaudeCode,
  Cursor,
  Windsurf,
];

/**
 * Find the first adapter that recognises the given payload.
 * Returns null if no adapter matches (unknown source).
 */
export function detectAdapter(body: Record<string, unknown>): HookAdapter | null {
  for (const adapter of ADAPTERS) {
    if (adapter.detect(body)) return adapter;
  }
  return null;
}
