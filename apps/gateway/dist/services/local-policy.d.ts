import { OculiEvent } from '../routes/adapters/schema';
export interface PolicyRuleMatch {
    tool?: string;
    command_pattern?: string;
    file_pattern?: string;
    mcp_server?: string;
}
export interface PolicyRule {
    id: string;
    match: PolicyRuleMatch;
    action: 'deny' | 'warn' | 'allow';
}
export interface LocalPolicyFile {
    rules: PolicyRule[];
}
export interface LocalPolicyResult {
    action: 'deny' | 'warn' | 'allow';
    matchedRules: PolicyRule[];
}
/**
 * Search for `.oculi/policy.yaml` starting from `startDir`, walking up to
 * the filesystem root, then falling back to `~/.oculi/policy.yaml`.
 * Returns the first path found, or null.
 */
export declare function findPolicyFile(startDir?: string): string | null;
/**
 * Load and parse a policy file. Returns null if the file doesn't exist.
 * Throws on parse errors so callers can decide how to handle them.
 */
export declare function loadPolicyFile(filePath: string): LocalPolicyFile;
export declare function ruleMatches(rule: PolicyRule, event: OculiEvent): boolean;
/**
 * Evaluate local policy rules against a normalized OculiEvent.
 *
 * - Only evaluates on `pre` phase events. Post/complete → allow.
 * - Collects all matching rules, highest-precedence action wins (deny > warn > allow).
 * - If no rules match → allow.
 */
export declare function evaluateLocalPolicy(event: OculiEvent, rules: PolicyRule[]): LocalPolicyResult;
