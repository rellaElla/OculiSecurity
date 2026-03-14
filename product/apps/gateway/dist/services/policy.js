"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyService = void 0;
const axios_1 = __importDefault(require("axios"));
// ---------------------------------------------------------------------------
// OPA Client
// ---------------------------------------------------------------------------
async function queryOPA(opaUrl, input) {
    const url = `${opaUrl}/v1/data/gateway/authz`;
    const response = await axios_1.default.post(url, { input }, { timeout: 3000 });
    const result = response.data.result ?? {};
    return {
        allow: result.allow ?? false,
        reason: result.reason ?? 'denied by policy',
        redactions: result.redactions ?? {},
        maxArgsSize: result.max_args_size ?? 102400,
    };
}
// ---------------------------------------------------------------------------
// Built-in fallback policy (mirrors gateway.rego logic in TypeScript)
// Used when OPA_ENABLED=false or OPA is unreachable.
// ---------------------------------------------------------------------------
const TOOL_ALLOWLISTS = {
    'fs-server': new Set(['readFile', 'listDir', 'writeFile']),
    'http-server': new Set(['fetchUrl', 'postUrl']),
};
const DANGEROUS_PATTERNS = [
    '../',
    '..\\',
    ';',
    '&&',
    '||',
    '`',
    '$(',
    '${',
    '%2e%2e',
    '%252e',
];
const WRITE_TOOLS = new Set(['writeFile', 'postUrl']);
const SENSITIVE_FIELDS = {
    secretKey: true,
    password: true,
    token: true,
    apiKey: true,
    secret: true,
    privateKey: true,
};
function fallbackPolicy(input) {
    // 1. Tool must be specified
    if (!input.tool) {
        return { allow: false, reason: 'tool not specified' };
    }
    // 2. Hook sources (IDE events) → always allow at gateway level.
    // Enforcement is handled by local policy on the client side.
    // The gateway's role for hooks is audit + centralized policy overlay.
    const isHookSource = input.upstreamId.startsWith('ext:');
    if (isHookSource) {
        return { allow: true, reason: 'allowed', redactions: {}, maxArgsSize: 102400 };
    }
    // ── Everything below applies only to MCP upstream proxy calls ──
    // 3. Tool must be in allowlist for this upstream
    const allowed = TOOL_ALLOWLISTS[input.upstreamId];
    if (!allowed || !allowed.has(input.tool)) {
        return { allow: false, reason: 'tool not in allowlist for this upstream' };
    }
    // 4. Dangerous argument patterns
    for (const [key, val] of Object.entries(input.args)) {
        if (typeof val === 'string') {
            for (const pattern of DANGEROUS_PATTERNS) {
                if (val.toLowerCase().includes(pattern.toLowerCase()) || val.includes(pattern)) {
                    return {
                        allow: false,
                        reason: `dangerous argument pattern detected in '${key}'`,
                    };
                }
            }
        }
    }
    // 5. Role restriction for write tools
    if (WRITE_TOOLS.has(input.tool)) {
        const hasWritePermission = input.roles.includes('admin') || input.roles.includes('editor');
        if (!hasWritePermission) {
            return {
                allow: false,
                reason: 'role restriction: insufficient permissions for write operations',
            };
        }
    }
    // Allow — determine redactions based on role
    const redactions = input.roles.includes('admin') ? {} : SENSITIVE_FIELDS;
    return {
        allow: true,
        reason: 'allowed',
        redactions,
        maxArgsSize: 102400,
    };
}
// ---------------------------------------------------------------------------
// PolicyService — chooses OPA or fallback
// ---------------------------------------------------------------------------
class PolicyService {
    opaUrl;
    opaEnabled;
    constructor(config) {
        this.opaUrl = config.opaUrl;
        this.opaEnabled = config.opaEnabled;
    }
    async evaluate(input) {
        if (!this.opaEnabled) {
            return fallbackPolicy(input);
        }
        try {
            return await queryOPA(this.opaUrl, input);
        }
        catch (err) {
            // OPA unreachable — fall back to built-in policy and log warning
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[policy] OPA unreachable (${msg}), using built-in fallback`);
            return fallbackPolicy(input);
        }
    }
}
exports.PolicyService = PolicyService;
//# sourceMappingURL=policy.js.map