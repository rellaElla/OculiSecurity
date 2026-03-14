import { PolicyDecision, Transform } from '../types';

/**
 * Apply policy redactions and transforms to an upstream response payload.
 *
 * - redactions: remove keys from the top-level response object (and recursively
 *   from nested objects)
 * - transforms: apply truncation, masking, or removal to specific fields
 */
export function sanitizeResponse(
  payload: unknown,
  decision: PolicyDecision
): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeResponse(item, decision));
  }

  const obj = payload as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  const redactions = decision.redactions ?? {};
  const transforms = decision.transforms ?? {};

  for (const [key, value] of Object.entries(obj)) {
    // Apply transform first (takes precedence)
    if (transforms[key]) {
      const transformed = applyTransform(value, transforms[key]);
      if (transformed !== REMOVED) {
        result[key] = transformed;
      }
      continue;
    }

    // Apply redaction
    if (redactions[key]) {
      // Replace value with placeholder rather than deleting the key,
      // so callers know a redaction occurred.
      result[key] = '[REDACTED]';
      continue;
    }

    // Recurse into nested objects
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeResponse(value, decision);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) => sanitizeResponse(item, decision));
    } else {
      result[key] = value;
    }
  }

  return result;
}

const REMOVED = Symbol('REMOVED');

function applyTransform(
  value: unknown,
  transform: Transform
): unknown | typeof REMOVED {
  switch (transform.type) {
    case 'remove':
      return REMOVED;

    case 'mask':
      if (typeof value === 'string') {
        return transform.mask ?? '***';
      }
      return '***';

    case 'truncate':
      if (typeof value === 'string') {
        const max = transform.maxLength ?? 1000;
        if (value.length > max) {
          return value.slice(0, max) + `...[truncated ${value.length - max} chars]`;
        }
      }
      return value;

    default:
      return value;
  }
}
