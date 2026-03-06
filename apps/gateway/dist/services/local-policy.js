"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPolicyFile = findPolicyFile;
exports.loadPolicyFile = loadPolicyFile;
exports.evaluateLocalPolicy = evaluateLocalPolicy;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const yaml_1 = __importDefault(require("yaml"));
// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------
/**
 * Search for `.oculi/policy.yaml` starting from `startDir`, walking up to
 * the filesystem root, then falling back to `~/.oculi/policy.yaml`.
 * Returns the first path found, or null.
 */
function findPolicyFile(startDir) {
    let dir = startDir ?? process.cwd();
    // Walk up from cwd
    while (true) {
        const candidate = path.join(dir, '.oculi', 'policy.yaml');
        if (fs.existsSync(candidate))
            return candidate;
        const parent = path.dirname(dir);
        if (parent === dir)
            break; // reached filesystem root
        dir = parent;
    }
    // Global fallback
    const globalPath = path.join(os.homedir(), '.oculi', 'policy.yaml');
    if (fs.existsSync(globalPath))
        return globalPath;
    return null;
}
/**
 * Load and parse a policy file. Returns null if the file doesn't exist.
 * Throws on parse errors so callers can decide how to handle them.
 */
function loadPolicyFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = yaml_1.default.parse(raw);
    if (!parsed || !Array.isArray(parsed.rules)) {
        return { rules: [] };
    }
    const rules = parsed.rules.map((r) => {
        const rule = r;
        const match = (rule.match ?? {});
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
                : 'deny'),
        };
    });
    return { rules };
}
// ---------------------------------------------------------------------------
// Rule matching
// ---------------------------------------------------------------------------
function ruleMatches(rule, event) {
    const { match } = rule;
    // All specified match fields must match (AND logic)
    if (match.tool != null) {
        if (event.tool !== match.tool)
            return false;
    }
    if (match.command_pattern != null) {
        const command = event.action?.command ?? event.shell_command;
        if (!command)
            return false;
        try {
            if (!new RegExp(match.command_pattern).test(command))
                return false;
        }
        catch {
            return false; // invalid regex → no match
        }
    }
    if (match.file_pattern != null) {
        const filePath = event.file_path ?? event.tool_args?.path;
        if (!filePath)
            return false;
        try {
            if (!new RegExp(match.file_pattern).test(filePath))
                return false;
        }
        catch {
            return false;
        }
    }
    if (match.mcp_server != null) {
        if (event.mcp_server !== match.mcp_server)
            return false;
    }
    // At least one match field must be specified (a rule with empty match is invalid)
    const hasAnyMatchField = match.tool != null || match.command_pattern != null ||
        match.file_pattern != null || match.mcp_server != null;
    return hasAnyMatchField;
}
// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------
const ACTION_PRECEDENCE = { deny: 3, warn: 2, allow: 1 };
/**
 * Evaluate local policy rules against a normalized OculiEvent.
 *
 * - Only evaluates on `pre` phase events. Post/complete → allow.
 * - Collects all matching rules, highest-precedence action wins (deny > warn > allow).
 * - If no rules match → allow.
 */
function evaluateLocalPolicy(event, rules) {
    // Only enforce on pre-phase events
    if (event.phase !== 'pre') {
        return { action: 'allow', matchedRules: [] };
    }
    const matchedRules = rules.filter((r) => ruleMatches(r, event));
    if (matchedRules.length === 0) {
        return { action: 'allow', matchedRules: [] };
    }
    // Highest precedence wins
    let highestAction = 'allow';
    for (const rule of matchedRules) {
        if (ACTION_PRECEDENCE[rule.action] > ACTION_PRECEDENCE[highestAction]) {
            highestAction = rule.action;
        }
    }
    return { action: highestAction, matchedRules };
}
//# sourceMappingURL=local-policy.js.map