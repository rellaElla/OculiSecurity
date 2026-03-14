import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { OculiEvent } from '../routes/adapters/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelemetryLogEntry {
  schema_version: string;
  ide_source: string;
  actor: string;
  org_id: string;
  hook_event_name: string;
  phase: string;
  session_id: string;
  trace_id?: string;
  tool?: string;
  tool_args?: Record<string, unknown>;
  file_path?: string;
  shell_command?: string;
  mcp_server?: string;
  timestamp: string;
  duration_ms?: number;
  error?: string;
  context?: { workspace?: string; conversation_id?: string };
  action?: { command?: string; content_hash?: string };
  policy_decision: 'allow' | 'warn' | 'deny';
  policy_rule_ids: string[];
}

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
export function findOrCreateOculiDir(startDir?: string): string {
  let dir = startDir ?? process.cwd();

  // Walk up to find existing .oculi/
  let search = dir;
  while (true) {
    const candidate = path.join(search, '.oculi');
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
    const parent = path.dirname(search);
    if (parent === search) break;
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
export function findTelemetryLog(startDir?: string): string | null {
  let dir = startDir ?? process.cwd();

  while (true) {
    const candidate = path.join(dir, '.oculi', LOG_FILENAME);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const globalPath = path.join(os.homedir(), '.oculi', LOG_FILENAME);
  if (fs.existsSync(globalPath)) return globalPath;

  return null;
}

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

function rotatedName(dir: string, n: number): string {
  return path.join(dir, `telemetry.${n}.jsonl`);
}

function rotateIfNeeded(logPath: string): void {
  if (!fs.existsSync(logPath)) return;

  let size: number;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return;
  }

  if (size < MAX_FILE_SIZE) return;

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
export function eventToLogEntry(
  event: OculiEvent,
  decision: 'allow' | 'warn' | 'deny',
  ruleIds: string[] = [],
): TelemetryLogEntry {
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
export function appendTelemetry(entry: TelemetryLogEntry, oculiDir?: string): string {
  const dir = oculiDir ?? findOrCreateOculiDir();
  const logPath = path.join(dir, LOG_FILENAME);

  rotateIfNeeded(logPath);

  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logPath, line, 'utf8');

  return logPath;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export interface ReadOptions {
  since?: Date;
  filter?: 'allow' | 'warn' | 'deny';
}

/**
 * Read telemetry log entries from a file with optional filtering.
 */
export function readTelemetryLines(logPath: string, opts: ReadOptions = {}): TelemetryLogEntry[] {
  if (!fs.existsSync(logPath)) return [];

  const raw = fs.readFileSync(logPath, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const entries: TelemetryLogEntry[] = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as TelemetryLogEntry;

      if (opts.since && new Date(entry.timestamp) < opts.since) continue;
      if (opts.filter && entry.policy_decision !== opts.filter) continue;

      entries.push(entry);
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

/**
 * Get the path to the telemetry log file (creating .oculi/ dir if needed).
 */
export function getTelemetryLogPath(oculiDir?: string): string {
  const dir = oculiDir ?? findOrCreateOculiDir();
  return path.join(dir, LOG_FILENAME);
}
