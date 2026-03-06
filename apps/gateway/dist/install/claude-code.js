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
exports.installClaudeCode = installClaudeCode;
exports.uninstallClaudeCode = uninstallClaudeCode;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/** Claude Code hook events managed by Oculi. */
const OCULI_EVENTS = ['PreToolUse', 'PostToolUse', 'Stop'];
const OCULI_MARKER = 'oculi emit claude-code';
function resolveConfigPath(opts) {
    const base = opts.global
        ? os.homedir()
        : (opts.cwd ?? process.cwd());
    return path.join(base, '.claude', 'settings.json');
}
function readSettings(filePath) {
    if (!fs.existsSync(filePath)) {
        return {};
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
}
function groupHasOculi(group) {
    return group.hooks.some((h) => h.command?.includes(OCULI_MARKER));
}
function installClaudeCode(opts) {
    const configPath = resolveConfigPath(opts);
    const settings = readSettings(configPath);
    const hooksMap = settings.hooks ?? {};
    const added = [];
    for (const event of OCULI_EVENTS) {
        const groups = hooksMap[event] ?? [];
        const alreadyInstalled = groups.some(groupHasOculi);
        if (!alreadyInstalled) {
            hooksMap[event] = [
                ...groups,
                {
                    matcher: '',
                    hooks: [{ type: 'command', command: `oculi emit claude-code ${event}` }],
                },
            ];
            added.push(event);
        }
    }
    if (!opts.dryRun && added.length > 0) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        const updated = { ...settings, hooks: hooksMap };
        fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
    }
    return { path: configPath, added, removed: [] };
}
function uninstallClaudeCode(opts) {
    const configPath = resolveConfigPath(opts);
    const settings = readSettings(configPath);
    const hooksMap = settings.hooks ?? {};
    const removed = [];
    for (const event of Object.keys(hooksMap)) {
        const before = hooksMap[event];
        const after = before.filter((g) => !groupHasOculi(g));
        if (after.length < before.length) {
            removed.push(...before.filter(groupHasOculi).map(() => event));
            if (after.length === 0) {
                delete hooksMap[event];
            }
            else {
                hooksMap[event] = after;
            }
        }
    }
    if (!opts.dryRun && removed.length > 0) {
        const updated = { ...settings, hooks: hooksMap };
        fs.writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');
    }
    return { path: configPath, added: [], removed };
}
//# sourceMappingURL=claude-code.js.map