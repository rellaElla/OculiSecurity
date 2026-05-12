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
exports.route = route;
exports.routeStdin = routeStdin;
exports.registeredAdapters = registeredAdapters;
const ClaudeCode = __importStar(require("./claude-code"));
const Cursor = __importStar(require("./cursor"));
const Windsurf = __importStar(require("./windsurf"));
/**
 * Central adapter registry.
 * Add new IDE adapters here — nothing else needs to change.
 */
const ADAPTER_REGISTRY = {
    'claude-code': ClaudeCode,
    'cursor': Cursor,
    'windsurf': Windsurf,
};
/**
 * Route a parsed hook payload to the correct adapter.
 *
 * Priority:
 *   1. Explicit — if `explicit` names a known adapter, use it immediately
 *      without inspecting the payload.  Zero detection overhead, deterministic.
 *   2. Auto-detect — iterate the registry until an adapter's detect() matches.
 *
 * Returns null when no adapter matches.
 */
function route(body, explicit) {
    // Strategy 1 — explicit adapter by name
    if (explicit) {
        const adapter = ADAPTER_REGISTRY[explicit.toLowerCase()];
        if (adapter) {
            return { adapterName: explicit.toLowerCase(), adapter, event: adapter.normalize(body) };
        }
    }
    // Strategy 2 — auto-detect from payload fields
    for (const [name, adapter] of Object.entries(ADAPTER_REGISTRY)) {
        if (adapter.detect(body)) {
            return { adapterName: name, adapter, event: adapter.normalize(body) };
        }
    }
    return null;
}
/**
 * Route a raw JSON string (hook stdin) to the correct adapter.
 * Parses stdin and delegates to route().
 *
 * @param stdin         Raw JSON string from the IDE hook.
 * @param explicitName  Optional adapter name — skips auto-detection when provided.
 */
function routeStdin(stdin, explicitName) {
    let body;
    try {
        body = JSON.parse(stdin);
    }
    catch {
        return null;
    }
    return route(body, explicitName);
}
/** Returns the canonical names of all registered adapters. */
function registeredAdapters() {
    return Object.keys(ADAPTER_REGISTRY);
}
