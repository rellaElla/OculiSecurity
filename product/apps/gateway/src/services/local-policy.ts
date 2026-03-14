import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import YAML from 'yaml';
import { OculiEvent } from '../routes/adapters/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Search for `.oculi/policy.yaml` starting from `startDir`, walking up to
 * the filesystem root, then falling back to `~/.oculi/policy.yaml`.
 * Returns the first path found, or null.
 */
export function findPolicyFile(startDir?: string): string | null {
  let dir = startDir ?? process.cwd();

  // Walk up from cwd
  while (true) {
    const candidate = path.join(dir, '.oculi', 'policy.yaml');
    if (fs.existsSync(candidate)) return candidate;

    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Global fallback
  const globalPath = path.join(os.homedir(), '.oculi', 'policy.yaml');
  if (fs.existsSync(globalPath)) return globalPath;

  return null;
}

/**
 * Load and parse a policy file. Returns null if the file doesn't exist.
 * Throws on parse errors so callers can decide how to handle them.
 */
export function loadPolicyFile(filePath: string): LocalPolicyFile {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = YAML.parse(raw) as { rules?: unknown[] };

  if (!parsed || !Array.isArray(parsed.rules)) {
    return { rules: [] };
  }

  const rules: PolicyRule[] = parsed.rules.map((r: unknown) => {
    const rule = r as Record<string, unknown>;
    const match = (rule.match ?? {}) as Record<string, unknown>;
    return {
      id: String(rule.id ?? 'unnamed'),
      match: {
        tool: match.tool != null ? String(match.tool) : undefined,
        command_pattern: match.command_pattern != null ? String(match.command_pattern) : undefined,
        file_pattern: match.file_pattern != null ? String(match.file_pattern) : undefined,
        mcp_server: match.mcp_server != null ? String(match.mcp_server) : undefined,
      },
      action: (['deny', 'warn', 'allow'].includes(String(rule.action))
        ? String(rule.action)
        : 'deny') as 'deny' | 'warn' | 'allow',
    };
  });

  return { rules };
}

// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------

function ruleMatches(rule: PolicyRule, event: OculiEvent): boolean {
  const { match } = rule;

  // All specified match fields must match (AND logic)
  if (match.tool != null) {
    if (event.tool !== match.tool) return false;
  }

  if (match.command_pattern != null) {
    const command = event.action?.command ?? event.shell_command;
    if (!command) return false;
    try {
      if (!new RegExp(match.command_pattern).test(command)) return false;
    } catch {
      return false; // invalid regex → no match
    }
  }

  if (match.file_pattern != null) {
    const filePath = event.file_path ?? (event.tool_args?.path as string | undefined);
    if (!filePath) return false;
    try {
      if (!new RegExp(match.file_pattern).test(filePath)) return false;
    } catch {
      return false;
    }
  }

  if (match.mcp_server != null) {
    if (event.mcp_server !== match.mcp_server) return false;
  }

  // At least one match field must be specified (a rule with empty match is invalid)
  const hasAnyMatchField = match.tool != null || match.command_pattern != null ||
    match.file_pattern != null || match.mcp_server != null;
  return hasAnyMatchField;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const ACTION_PRECEDENCE: Record<string, number> = { deny: 3, warn: 2, allow: 1 };

/**
 * Evaluate local policy rules against a normalized OculiEvent.
 *
 * - Only evaluates on `pre` phase events. Post/complete → allow.
 * - Collects all matching rules, highest-precedence action wins (deny > warn > allow).
 * - If no rules match → allow.
 */
export function evaluateLocalPolicy(
  event: OculiEvent,
  rules: PolicyRule[],
): LocalPolicyResult {
  // Only enforce on pre-phase events
  if (event.phase !== 'pre') {
    return { action: 'allow', matchedRules: [] };
  }

  const matchedRules = rules.filter((r) => ruleMatches(r, event));

  if (matchedRules.length === 0) {
    return { action: 'allow', matchedRules: [] };
  }

  // Highest precedence wins
  let highestAction: 'deny' | 'warn' | 'allow' = 'allow';
  for (const rule of matchedRules) {
    if (ACTION_PRECEDENCE[rule.action] > ACTION_PRECEDENCE[highestAction]) {
      highestAction = rule.action;
    }
  }

  return { action: highestAction, matchedRules };
}
