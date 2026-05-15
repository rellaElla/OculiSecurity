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
exports.defaultDataDir = defaultDataDir;
exports.ensureDataDir = ensureDataDir;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/** Default data directory: ~/.oculi/ */
function defaultDataDir() {
    return path.join(os.homedir(), '.oculi');
}
/**
 * Ensure `dir` exists and is locked down to the current user (chmod 700).
 * Returns the absolute path. Idempotent.
 */
function ensureDataDir(dir) {
    const abs = path.resolve(dir);
    fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
    // mkdir's `mode` is masked by umask on existing dirs; chmod is the
    // authoritative fix when the dir was created earlier with a wider mode.
    try {
        fs.chmodSync(abs, 0o700);
    }
    catch {
        // Best-effort — chmod can fail on Windows / weird filesystems.
    }
    return abs;
}
