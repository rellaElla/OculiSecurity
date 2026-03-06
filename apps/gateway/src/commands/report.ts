import { findTelemetryLog, readTelemetryLines, TelemetryLogEntry } from '../services/telemetry-log';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportData {
  period: { from: string; to: string; hours: number };
  total: number;
  by_phase: Record<string, number>;
  by_tool: Array<{ tool: string; count: number }>;
  by_ide: Array<{ ide: string; count: number; percent: number }>;
  violations: Array<{
    timestamp: string;
    decision: string;
    tool: string;
    detail: string;
    rule_ids: string[];
  }>;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

export function buildReport(entries: TelemetryLogEntry[], hours: number): ReportData {
  const now = new Date();
  const since = new Date(now.getTime() - hours * 3600_000);

  const byPhase: Record<string, number> = {};
  const toolCounts: Record<string, number> = {};
  const ideCounts: Record<string, number> = {};
  const violations: ReportData['violations'] = [];

  for (const e of entries) {
    // Phase
    byPhase[e.phase] = (byPhase[e.phase] ?? 0) + 1;

    // Tool
    const tool = e.tool ?? '(none)';
    toolCounts[tool] = (toolCounts[tool] ?? 0) + 1;

    // IDE
    ideCounts[e.ide_source] = (ideCounts[e.ide_source] ?? 0) + 1;

    // Violations
    if (e.policy_decision === 'deny' || e.policy_decision === 'warn') {
      let detail = '—';
      if (e.action?.command) detail = e.action.command;
      else if (e.file_path) detail = e.file_path;
      else if (e.shell_command) detail = e.shell_command;
      else if (e.mcp_server) detail = e.mcp_server;

      violations.push({
        timestamp: e.timestamp,
        decision: e.policy_decision,
        tool,
        detail,
        rule_ids: e.policy_rule_ids ?? [],
      });
    }
  }

  const total = entries.length;

  const byTool = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => ({ tool, count }));

  const byIde = Object.entries(ideCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([ide, count]) => ({
      ide,
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
    }));

  return {
    period: { from: since.toISOString(), to: now.toISOString(), hours },
    total,
    by_phase: byPhase,
    by_tool: byTool,
    by_ide: byIde,
    violations,
  };
}

// ---------------------------------------------------------------------------
// Human-readable formatting
// ---------------------------------------------------------------------------

function bar(count: number, max: number, width: number = 20): string {
  if (max === 0) return '';
  const filled = Math.round((count / max) * width);
  return '█'.repeat(filled);
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('sv-SE', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }).replace('T', ' ');
}

export function formatReport(report: ReportData): string {
  const lines: string[] = [];

  const from = formatTimestamp(report.period.from);
  const to = formatTimestamp(report.period.to);
  lines.push(`Oculi Report — last ${report.period.hours} hours (${from} → ${to})`);
  lines.push('');

  // Event counts by phase
  const phaseStr = Object.entries(report.by_phase)
    .map(([phase, count]) => `${count} ${phase}`)
    .join(', ');
  lines.push(`Events: ${report.total} total${phaseStr ? ` (${phaseStr})` : ''}`);
  lines.push('');

  // By tool
  if (report.by_tool.length > 0) {
    lines.push('By tool:');
    const maxCount = report.by_tool[0]?.count ?? 0;
    for (const { tool, count } of report.by_tool) {
      lines.push(`  ${padRight(tool, 14)} ${String(count).padStart(4)}  ${bar(count, maxCount)}`);
    }
    lines.push('');
  }

  // By IDE
  if (report.by_ide.length > 0) {
    lines.push('By IDE:');
    for (const { ide, count, percent } of report.by_ide) {
      lines.push(`  ${padRight(ide, 14)} ${String(count).padStart(4)} (${percent}%)`);
    }
    lines.push('');
  }

  // Violations
  if (report.violations.length > 0) {
    lines.push(`Policy violations (${report.violations.length}):`);
    for (const v of report.violations) {
      const ts = formatTimestamp(v.timestamp);
      const ruleStr = v.rule_ids.length > 0 ? v.rule_ids.join(', ') : '—';
      lines.push(`  ${ts}  ${padRight(v.decision, 5)} ${padRight(v.tool, 12)} ${padRight(v.detail, 25)} ${ruleStr}`);
    }
  } else {
    lines.push('Policy violations: none');
  }

  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export interface ReportOptions {
  json: boolean;
  hours: number;
}

export function runReport(opts: ReportOptions): void {
  const logPath = findTelemetryLog();
  if (!logPath) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ error: 'no telemetry log found' }) + '\n');
    } else {
      process.stderr.write('oculi: no telemetry log found. Run some commands first.\n');
    }
    process.exit(1);
  }

  const since = new Date(Date.now() - opts.hours * 3600_000);
  const entries = readTelemetryLines(logPath, { since });
  const report = buildReport(entries, opts.hours);

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    process.stdout.write(formatReport(report));
  }
}
