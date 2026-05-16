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
exports.runInit = runInit;
const os = __importStar(require("os"));
const detect_1 = require("../install/detect");
const claude_code_1 = require("../install/claude-code");
const cursor_1 = require("../install/cursor");
const init_1 = require("../init");
const AGENT_LABEL = {
    'claude-code': { configPath: '~/.claude/settings.json' },
    cursor: { configPath: '~/.cursor/hooks.json' },
};
/** Render an absolute path with the user's home dir collapsed to ~. */
function tilde(absPath, home) {
    return absPath.startsWith(home) ? '~' + absPath.slice(home.length) : absPath;
}
function runInit(opts = {}) {
    const home = opts.home ?? os.homedir();
    // 1. Resolve target agent list.
    let targets;
    let explicit = false;
    if (opts.agent) {
        explicit = true;
        if (!(0, detect_1.isAgentInstalled)(opts.agent)) {
            const bin = detect_1.BINARIES[opts.agent];
            process.stderr.write(`oculi: '${opts.agent}' not found on PATH (looked for '${bin}').\n` +
                `If you have ${opts.agent === 'claude-code' ? 'Claude Code' : 'Cursor'} installed, make sure \`${bin}\` is on your PATH.\n` +
                `Otherwise run \`oculi init\` (no --agent) to write the policy and skip hook wiring.\n`);
            return { exitCode: 1, policyPath: null, policyCreated: false, wired: [], added: {} };
        }
        targets = [opts.agent];
    }
    else {
        targets = (0, detect_1.detectAgents)();
    }
    // 2. Write ~/.oculi/policy.yaml if missing (always — even when no agents are detected).
    const policy = (0, init_1.runInit)({ home });
    // 3. No agents detected → warn, don't wire, exit 0.
    if (targets.length === 0) {
        process.stdout.write((policy.created
            ? `Created ${tilde(policy.path, home)}\n`
            : `policy already exists, leaving alone (${tilde(policy.path, home)})\n`) +
            `\n` +
            `No supported agents detected on PATH.\n` +
            `  - For Claude Code: install it from https://claude.com/claude-code\n` +
            `    and ensure \`claude\` is on your PATH.\n` +
            `  - For Cursor: in Cursor, run "Shell Command: Install 'cursor' command\n` +
            `    in PATH" from the command palette.\n` +
            `\n` +
            `Once an agent is on PATH, re-run \`oculi init\` to wire hooks.\n`);
        return {
            exitCode: 0,
            policyPath: policy.path,
            policyCreated: policy.created,
            wired: [],
            added: {},
        };
    }
    // 4. Wire each target agent's hooks (installers are idempotent).
    const added = {};
    for (const a of targets) {
        const r = a === 'claude-code' ? (0, claude_code_1.installClaudeCode)({ home }) : (0, cursor_1.installCursor)({ home });
        added[a] = r.added;
    }
    // 5. Print stdout summary.
    let out = '';
    if (!explicit) {
        out += `Detected agents: ${targets.join(', ')}\n`;
    }
    out += policy.created
        ? `Created ${tilde(policy.path, home)}\n`
        : `policy already exists, leaving alone (${tilde(policy.path, home)})\n`;
    for (const a of targets) {
        const events = added[a] ?? [];
        const cfg = AGENT_LABEL[a].configPath;
        if (events.length === 0) {
            out += `Wired ${a} hooks → ${cfg} (already up to date)\n`;
        }
        else {
            out += `Wired ${a} hooks → ${cfg}\n`;
            for (const e of events) {
                out += `  + ${e}\n`;
            }
        }
    }
    out += `\nRestart your IDE for the hooks to take effect.\n`;
    out += `Then run \`oculi serve\` to view events in the dashboard.\n`;
    out += `\n`;
    out += `To remove later, run BOTH (in order):\n`;
    out += `  oculi uninstall                         # removes hooks + policy\n`;
    out += `  npm uninstall -g @oculisecurity/cli     # removes the binary\n`;
    out += `(npm uninstall alone won't clean the hooks — npm has no way to know\n`;
    out += ` about files we wrote outside our own package directory.)\n`;
    process.stdout.write(out);
    return {
        exitCode: 0,
        policyPath: policy.path,
        policyCreated: policy.created,
        wired: targets,
        added,
    };
}
