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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUninstall = runUninstall;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const detect_1 = require("../install/detect");
const claude_code_1 = require("../install/claude-code");
const cursor_1 = require("../install/cursor");
const AGENT_LABEL = {
    'claude-code': { configPath: '~/.claude/settings.json' },
    cursor: { configPath: '~/.cursor/hooks.json' },
};
/** Render an absolute path with the user's home dir collapsed to ~. */
function tilde(absPath, home) {
    return absPath.startsWith(home) ? '~' + absPath.slice(home.length) : absPath;
}
function agentHasOculi(agent, home) {
    return agent === 'claude-code' ? (0, claude_code_1.hasOculiHooks)(home) : (0, cursor_1.hasOculiHooks)(home);
}
function runUninstall(opts = {}) {
    const home = opts.home ?? os.homedir();
    const explicit = opts.agent !== undefined;
    const targets = opts.agent ? [opts.agent] : [...detect_1.AGENTS];
    const policyPath = path.join(home, '.oculi', 'policy.yaml');
    const policyExistedBefore = fs.existsSync(policyPath);
    // Remove hooks for each target. Existing per-agent uninstallers preserve
    // non-oculi entries — we never write JSON files directly here.
    const removed = {};
    for (const a of targets) {
        const r = a === 'claude-code' ? (0, claude_code_1.uninstallClaudeCode)({ home }) : (0, cursor_1.uninstallCursor)({ home });
        removed[a] = r.removed;
    }
    // After per-agent uninstall, recompute which agents still have oculi markers
    // on disk. We scan BOTH agents regardless of which one we just touched.
    const remainingAgents = detect_1.AGENTS.filter((a) => agentHasOculi(a, home));
    // Policy removal rule: delete ~/.oculi/policy.yaml iff no agent has an oculi marker.
    let policyRemoved = false;
    if (remainingAgents.length === 0 && policyExistedBefore) {
        try {
            fs.rmSync(policyPath);
            policyRemoved = true;
        }
        catch {
            // best effort
        }
        // NOTE: do NOT rmdir ~/.oculi/ — the dashboard's oculi.db and telemetry.jsonl
        // live there. Only the policy file is owned by us.
    }
    // Build stdout.
    const changes = [];
    const notices = [];
    for (const a of targets) {
        const ev = removed[a] ?? [];
        const cfg = AGENT_LABEL[a].configPath;
        if (ev.length > 0) {
            changes.push(`Removed ${a} hooks ← ${cfg}`);
            for (const e of ev)
                changes.push(`  - ${e}`);
        }
        else if (explicit) {
            notices.push(`No oculi hooks found for ${a} in ${cfg}.`);
        }
    }
    if (policyRemoved) {
        changes.push(`Removed ${tilde(policyPath, home)}`);
    }
    else if (policyExistedBefore && remainingAgents.length > 0) {
        notices.push(`Leaving ${tilde(policyPath, home)} in place (${remainingAgents.join(', ')} is still wired).`);
    }
    if (changes.length === 0 && notices.length === 0) {
        process.stdout.write(`Nothing to remove — no oculi hooks or policy found.\n`);
    }
    else {
        process.stdout.write([...changes, ...notices].join('\n') + '\n');
    }
    return { exitCode: 0, removed, policyRemoved, remainingAgents };
}
