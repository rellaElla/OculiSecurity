import * as fs from 'fs';
import { findTelemetryLog, TelemetryLogEntry } from '../services/telemetry-log';

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------

function useColor(): boolean {
  if (process.env.NO_COLOR) return false;
  return process.stdout.isTTY === true;
}

const color = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

function c(code: string, text: string, enabled: boolean): string {
  return enabled ? `${code}${text}${color.reset}` : text;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

export function formatEntry(entry: TelemetryLogEntry, colorEnabled: boolean): string {
  // Time: HH:MM:SS
  const ts = new Date(entry.timestamp);
  const time = [
    String(ts.getHours()).padStart(2, '0'),
    String(ts.getMinutes()).padStart(2, '0'),
    String(ts.getSeconds()).padStart(2, '0'),
  ].join(':');

  // Phase
  const phaseMap: Record<string, string> = { pre: 'PRE ', post: 'POST', complete: 'DONE' };
  const phase = phaseMap[entry.phase] ?? entry.phase.toUpperCase().slice(0, 4);

  // Tool
  const tool = padRight(entry.tool ?? '—', 10);

  // Detail: command for shell, file_path for file ops, mcp_server for mcp
  let detail = '—';
  if (entry.action?.command) {
    detail = entry.action.command;
  } else if (entry.file_path) {
    detail = entry.file_path;
  } else if (entry.shell_command) {
    detail = entry.shell_command;
  } else if (entry.mcp_server) {
    detail = entry.mcp_server;
  } else if (entry.tool_args) {
    // Fallback: show first string arg value
    for (const val of Object.values(entry.tool_args)) {
      if (typeof val === 'string' && val.length > 0) {
        detail = val;
        break;
      }
    }
  }
  detail = truncate(detail, 40);

  // Decision
  let decisionStr: string;
  const ruleIds = entry.policy_rule_ids?.length ? ` (${entry.policy_rule_ids.join(', ')})` : '';
  switch (entry.policy_decision) {
    case 'allow':
      decisionStr = c(color.green, `✅ allow${ruleIds}`, colorEnabled);
      break;
    case 'warn':
      decisionStr = c(color.yellow, `⚠️  warn${ruleIds}`, colorEnabled);
      break;
    case 'deny':
      decisionStr = c(color.red, `🚫 deny${ruleIds}`, colorEnabled);
      break;
    default:
      decisionStr = entry.policy_decision;
  }

  const timeStr = c(color.dim, `[${time}]`, colorEnabled);
  const phaseStr = c(color.cyan, phase, colorEnabled);
  const toolStr = c(color.white, tool, colorEnabled);

  return `${timeStr} ${phaseStr} | ${toolStr} | ${padRight(detail, 40)} | ${decisionStr}`;
}

// ---------------------------------------------------------------------------
// Tail command
// ---------------------------------------------------------------------------

export interface TailOptions {
  filter?: 'allow' | 'warn' | 'deny';
  noColor?: boolean;
}

export function runTail(opts: TailOptions): void {
  const logPath = findTelemetryLog();
  if (!logPath) {
    process.stderr.write('oculi: no telemetry log found. Run some commands first.\n');
    process.exit(1);
  }

  const colorEnabled = !opts.noColor && useColor();

  // Print existing lines from near the end
  let fileSize = 0;
  try {
    fileSize = fs.statSync(logPath).size;
  } catch {
    // File might not exist yet
  }

  // Read last ~64KB for initial display
  const TAIL_BYTES = 64 * 1024;
  const startPos = Math.max(0, fileSize - TAIL_BYTES);

  if (fileSize > 0) {
    const fd = fs.openSync(logPath, 'r');
    const buf = Buffer.alloc(Math.min(fileSize, TAIL_BYTES));
    fs.readSync(fd, buf, 0, buf.length, startPos);
    fs.closeSync(fd);

    const text = buf.toString('utf8');
    const lines = text.split('\n');
    // If we started mid-line, skip the first partial line
    const start = startPos > 0 ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try {
        const entry = JSON.parse(line) as TelemetryLogEntry;
        if (opts.filter && entry.policy_decision !== opts.filter) continue;
        process.stdout.write(formatEntry(entry, colorEnabled) + '\n');
      } catch {
        // Skip malformed
      }
    }
  }

  // Watch for new lines
  let currentSize = fileSize;

  const watcher = fs.watch(logPath, () => {
    let newSize: number;
    try {
      newSize = fs.statSync(logPath).size;
    } catch {
      return;
    }

    if (newSize <= currentSize) {
      // File was rotated — reset
      currentSize = 0;
      return;
    }

    const fd = fs.openSync(logPath, 'r');
    const bytesToRead = newSize - currentSize;
    const buf = Buffer.alloc(bytesToRead);
    fs.readSync(fd, buf, 0, bytesToRead, currentSize);
    fs.closeSync(fd);
    currentSize = newSize;

    const text = buf.toString('utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const entry = JSON.parse(trimmed) as TelemetryLogEntry;
        if (opts.filter && entry.policy_decision !== opts.filter) continue;
        process.stdout.write(formatEntry(entry, colorEnabled) + '\n');
      } catch {
        // Skip
      }
    }
  });

  // Clean exit on SIGINT
  process.on('SIGINT', () => {
    watcher.close();
    process.exit(0);
  });
}
