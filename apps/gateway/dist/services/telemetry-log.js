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
exports.findOrCreateOculiDir = findOrCreateOculiDir;
exports.findTelemetryLog = findTelemetryLog;
exports.eventToLogEntry = eventToLogEntry;
exports.appendTelemetry = appendTelemetry;
exports.readTelemetryLines = readTelemetryLines;
exports.getTelemetryLogPath = getTelemetryLogPath;
exports.readTelemetryLinesFromOffset = readTelemetryLinesFromOffset;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
// ---------------------------------------------------------------------------
// Directory discovery
// ---------------------------------------------------------------------------
const LOG_FILENAME = 'telemetry.jsonl';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_ROTATIONS = 5;
/**
 * Find the nearest `.oculi/` directory by walking up from `startDir`.
 * If none is found, creates `.oculi/` in startDir (or cwd).
 */
function findOrCreateOculiDir(startDir) {
    let dir = startDir ?? process.cwd();
    // Walk up to find existing .oculi/
    let search = dir;
    while (true) {
        const candidate = path.join(search, '.oculi');
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
            return candidate;
        }
        const parent = path.dirname(search);
        if (parent === search)
            break;
        search = parent;
    }
    // Check home directory
    const globalDir = path.join(os.homedir(), '.oculi');
    if (fs.existsSync(globalDir) && fs.statSync(globalDir).isDirectory()) {
        return globalDir;
    }
    // Create in the starting directory
    const newDir = path.join(dir, '.oculi');
    fs.mkdirSync(newDir, { recursive: true });
    return newDir;
}
/**
 * Find existing `.oculi/telemetry.jsonl` by walking up. Returns null if none exists.
 */
function findTelemetryLog(startDir) {
    let dir = startDir ?? process.cwd();
    while (true) {
        const candidate = path.join(dir, '.oculi', LOG_FILENAME);
        if (fs.existsSync(candidate))
            return candidate;
        const parent = path.dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    const globalPath = path.join(os.homedir(), '.oculi', LOG_FILENAME);
    if (fs.existsSync(globalPath))
        return globalPath;
    return null;
}
// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------
function rotatedName(dir, n) {
    return path.join(dir, `telemetry.${n}.jsonl`);
}
function rotateIfNeeded(logPath) {
    if (!fs.existsSync(logPath))
        return;
    let size;
    try {
        size = fs.statSync(logPath).size;
    }
    catch {
        return;
    }
    if (size < MAX_FILE_SIZE)
        return;
    const dir = path.dirname(logPath);
    // Delete oldest if at cap
    const oldest = rotatedName(dir, MAX_ROTATIONS);
    if (fs.existsSync(oldest)) {
        fs.unlinkSync(oldest);
    }
    // Shift existing rotated files up: N → N+1
    for (let i = MAX_ROTATIONS - 1; i >= 1; i--) {
        const from = rotatedName(dir, i);
        const to = rotatedName(dir, i + 1);
        if (fs.existsSync(from)) {
            fs.renameSync(from, to);
        }
    }
    // Rename current → .1
    fs.renameSync(logPath, rotatedName(dir, 1));
}
// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------
/**
 * Convert an OculiEvent + policy decision into a log entry (omitting raw_payload).
 */
function eventToLogEntry(event, decision, ruleIds = []) {
    return {
        schema_version: event.schema_version,
        ide_source: event.ide_source,
        actor: event.actor,
        org_id: event.org_id,
        hook_event_name: event.hook_event_name,
        phase: event.phase,
        session_id: event.session_id,
        trace_id: event.trace_id,
        tool: event.tool,
        tool_args: event.tool_args,
        file_path: event.file_path,
        shell_command: event.shell_command,
        mcp_server: event.mcp_server,
        timestamp: event.timestamp,
        duration_ms: event.duration_ms,
        error: event.error,
        context: event.context,
        action: event.action,
        policy_decision: decision,
        policy_rule_ids: ruleIds,
    };
}
/**
 * Append a telemetry log entry to `.oculi/telemetry.jsonl`.
 * Handles rotation automatically.
 */
function appendTelemetry(entry, oculiDir) {
    const dir = oculiDir ?? findOrCreateOculiDir();
    const logPath = path.join(dir, LOG_FILENAME);
    rotateIfNeeded(logPath);
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(logPath, line, 'utf8');
    return logPath;
}
/**
 * Read telemetry log entries from a file with optional filtering.
 */
function readTelemetryLines(logPath, opts = {}) {
    if (!fs.existsSync(logPath))
        return [];
    const raw = fs.readFileSync(logPath, 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const entries = [];
    for (const line of lines) {
        try {
            const entry = JSON.parse(line);
            if (opts.since && new Date(entry.timestamp) < opts.since)
                continue;
            if (opts.filter && entry.policy_decision !== opts.filter)
                continue;
            entries.push(entry);
        }
        catch {
            // Skip malformed lines
        }
    }
    return entries;
}
/**
 * Get the path to the telemetry log file (creating .oculi/ dir if needed).
 */
function getTelemetryLogPath(oculiDir) {
    const dir = oculiDir ?? findOrCreateOculiDir();
    return path.join(dir, LOG_FILENAME);
}
/**
 * Read telemetry entries starting at a byte offset. Used for incremental
 * replay into sqlite — caller persists `newOffset` to resume next time.
 *
 * If the file is shorter than `offset` (rotation happened since last read),
 * starts from byte 0 and reports `rotated: true`.
 */
function readTelemetryLinesFromOffset(filePath, offset) {
    if (!fs.existsSync(filePath)) {
        return { entries: [], newOffset: offset, skipped: 0, rotated: false };
    }
    const size = fs.statSync(filePath).size;
    let rotated = false;
    let startOffset = offset;
    if (size < offset) {
        rotated = true;
        startOffset = 0;
    }
    if (size === startOffset) {
        return { entries: [], newOffset: startOffset, skipped: 0, rotated };
    }
    const fd = fs.openSync(filePath, 'r');
    const length = size - startOffset;
    const buf = Buffer.alloc(length);
    try {
        fs.readSync(fd, buf, 0, length, startOffset);
    }
    finally {
        fs.closeSync(fd);
    }
    const text = buf.toString('utf8');
    // If the file does NOT end in a newline, the trailing fragment is a
    // half-written line — don't consume it. The next read will pick it up.
    const lastNewlineRel = text.lastIndexOf('\n');
    if (lastNewlineRel === -1) {
        // No complete line in this slice yet — leave offset unchanged.
        return { entries: [], newOffset: offset, skipped: 0, rotated };
    }
    const consumed = text.slice(0, lastNewlineRel + 1);
    const newOffset = startOffset + Buffer.byteLength(consumed, 'utf8');
    const entries = [];
    let skipped = 0;
    for (const line of consumed.split('\n')) {
        if (line.trim().length === 0)
            continue;
        try {
            entries.push(JSON.parse(line));
        }
        catch {
            skipped++;
        }
    }
    return { entries, newOffset, skipped, rotated };
}
