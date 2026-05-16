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
exports.installCursor = installCursor;
exports.uninstallCursor = uninstallCursor;
exports.hasOculiHooks = hasOculiHooks;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/** Cursor hook events managed by Oculi. */
const OCULI_EVENTS = [
    'beforeShellExecution',
    'afterFileEdit',
    'beforeReadFile',
    'beforeMCPExecution',
    'stop',
];
const OCULI_MARKER = 'oculi emit cursor';
function resolveConfigPath(opts) {
    return path.join(opts.home ?? os.homedir(), '.cursor', 'hooks.json');
}
function readConfig(filePath) {
    if (!fs.existsSync(filePath)) {
        return { version: 1, hooks: {} };
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
        version: parsed.version ?? 1,
        hooks: parsed.hooks ?? {},
    };
}
function installCursor(opts = {}) {
    const configPath = resolveConfigPath(opts);
    const config = readConfig(configPath);
    const added = [];
    for (const event of OCULI_EVENTS) {
        const entries = config.hooks[event] ?? [];
        const alreadyInstalled = entries.some((e) => e.command.includes(OCULI_MARKER));
        if (!alreadyInstalled) {
            config.hooks[event] = [...entries, { command: `oculi emit cursor ${event}` }];
            added.push(event);
        }
    }
    if (added.length > 0) {
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    }
    return { path: configPath, added, removed: [] };
}
function uninstallCursor(opts = {}) {
    const configPath = resolveConfigPath(opts);
    const config = readConfig(configPath);
    const removed = [];
    for (const event of Object.keys(config.hooks)) {
        const before = config.hooks[event];
        const after = before.filter((e) => !e.command.includes(OCULI_MARKER));
        if (after.length < before.length) {
            removed.push(...before.filter((e) => e.command.includes(OCULI_MARKER)).map(() => event));
            if (after.length === 0) {
                delete config.hooks[event];
            }
            else {
                config.hooks[event] = after;
            }
        }
    }
    if (removed.length > 0) {
        if (Object.keys(config.hooks).length === 0) {
            fs.writeFileSync(configPath, JSON.stringify({ version: config.version, hooks: {} }, null, 2) + '\n', 'utf8');
        }
        else {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
        }
    }
    return { path: configPath, added: [], removed };
}
/** Does ~/.cursor/hooks.json still have any oculi-marked hook? */
function hasOculiHooks(home) {
    const configPath = resolveConfigPath({ home });
    const config = readConfig(configPath);
    for (const entries of Object.values(config.hooks)) {
        if (entries.some((e) => e.command.includes(OCULI_MARKER)))
            return true;
    }
    return false;
}
