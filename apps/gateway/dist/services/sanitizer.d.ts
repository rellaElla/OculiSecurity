import { PolicyDecision } from '../types';
/**
 * Apply policy redactions and transforms to an upstream response payload.
 *
 * - redactions: remove keys from the top-level response object (and recursively
 *   from nested objects)
 * - transforms: apply truncation, masking, or removal to specific fields
 */
export declare function sanitizeResponse(payload: unknown, decision: PolicyDecision): unknown;
//# sourceMappingURL=sanitizer.d.ts.map