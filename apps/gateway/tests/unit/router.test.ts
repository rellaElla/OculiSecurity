import { describe, it, expect } from 'vitest';
import { route, routeStdin, registeredAdapters } from '../../src/routes/adapters/router';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CC_PAYLOAD = {
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'npm test' },
  session_id: 'cc-session-1',
  cwd: '/workspace',
};

const CURSOR_PAYLOAD = {
  hook_event_name: 'beforeShellExecution',
  conversation_id: 'cursor-conv-1',
  generation_id: 'cursor-gen-1',
  content: 'npm test',
  workspace_roots: ['/workspace'],
};

const WINDSURF_PAYLOAD = {
  agent_action_name: 'pre_mcp_tool_use',
  tool_info: { mcp_server_name: 'fs', mcp_tool_name: 'readFile', mcp_tool_arguments: {} },
  trajectory_id: 'traj-1',
  execution_id: 'exec-1',
};

// ── Auto-detection ────────────────────────────────────────────────────────────

describe('route() — auto-detection', () => {
  it('detects Claude Code payload', () => {
    const result = route(CC_PAYLOAD);
    expect(result).not.toBeNull();
    expect(result!.adapterName).toBe('claude-code');
    expect(result!.event.ide_source).toBe('claude-code');
    expect(result!.event.tool).toBe('shell'); // Bash → normalised
  });

  it('detects Cursor payload', () => {
    const result = route(CURSOR_PAYLOAD);
    expect(result).not.toBeNull();
    expect(result!.adapterName).toBe('cursor');
    expect(result!.event.ide_source).toBe('cursor');
    expect(result!.event.tool).toBe('shell');
  });

  it('detects Windsurf payload', () => {
    const result = route(WINDSURF_PAYLOAD);
    expect(result).not.toBeNull();
    expect(result!.adapterName).toBe('windsurf');
    expect(result!.event.ide_source).toBe('windsurf');
  });

  it('returns null for an unrecognised payload', () => {
    expect(route({ unknown_field: 'mystery' })).toBeNull();
    expect(route({})).toBeNull();
  });
});

// ── Explicit adapter selection ────────────────────────────────────────────────

describe('route() — explicit adapter (takes priority)', () => {
  it('selects claude-code by name even when payload is ambiguous', () => {
    // Minimal payload that only claude-code can auto-detect, but we force it
    const result = route(CC_PAYLOAD, 'claude-code');
    expect(result!.adapterName).toBe('claude-code');
  });

  it('selects cursor by name regardless of payload content', () => {
    // Force cursor adapter even if the payload looks like Claude Code
    const result = route(CC_PAYLOAD, 'cursor');
    expect(result!.adapterName).toBe('cursor');
  });

  it('selects windsurf by name', () => {
    const result = route(WINDSURF_PAYLOAD, 'windsurf');
    expect(result!.adapterName).toBe('windsurf');
  });

  it('is case-insensitive', () => {
    const result = route(CC_PAYLOAD, 'Claude-Code');
    expect(result!.adapterName).toBe('claude-code');
  });

  it('falls back to auto-detect when explicit name is unknown', () => {
    // 'vscode' not registered → falls back to detect from payload
    const result = route(CC_PAYLOAD, 'vscode');
    // auto-detects as claude-code
    expect(result!.adapterName).toBe('claude-code');
  });

  it('explicit adapter overrides auto-detect result', () => {
    // Same Cursor payload, but we force claude-code
    const auto = route(CURSOR_PAYLOAD);
    expect(auto!.adapterName).toBe('cursor');  // baseline

    const explicit = route(CURSOR_PAYLOAD, 'claude-code');
    expect(explicit!.adapterName).toBe('claude-code'); // overridden
  });
});

// ── routeStdin ────────────────────────────────────────────────────────────────

describe('routeStdin()', () => {
  it('parses stdin JSON and routes correctly', () => {
    const result = routeStdin(JSON.stringify(CC_PAYLOAD));
    expect(result!.adapterName).toBe('claude-code');
    expect(result!.event.tool).toBe('shell');
  });

  it('respects explicit adapter from caller', () => {
    const result = routeStdin(JSON.stringify(CC_PAYLOAD), 'cursor');
    expect(result!.adapterName).toBe('cursor');
  });

  it('returns null for invalid JSON', () => {
    expect(routeStdin('not json')).toBeNull();
    expect(routeStdin('')).toBeNull();
  });

  it('returns null for unrecognised valid JSON', () => {
    expect(routeStdin('{"foo":"bar"}')).toBeNull();
  });
});

// ── RouteResult shape ─────────────────────────────────────────────────────────

describe('RouteResult', () => {
  it('exposes adapter, adapterName, and event', () => {
    const result = route(CC_PAYLOAD)!;
    expect(result.adapter).toBeDefined();
    expect(result.adapterName).toBe('claude-code');
    expect(result.event.schema_version).toBe('1');
  });

  it('adapter.formatAllow() returns a non-empty string', () => {
    const result = route(CC_PAYLOAD)!;
    expect(JSON.parse(result.adapter.formatAllow(result.event))).toBeTruthy();
  });

  it('adapter.denyStatusCode() returns 200 for Claude Code', () => {
    expect(route(CC_PAYLOAD)!.adapter.denyStatusCode()).toBe(200);
  });

  it('adapter.denyStatusCode() returns 200 for Cursor', () => {
    expect(route(CURSOR_PAYLOAD)!.adapter.denyStatusCode()).toBe(200);
  });

  it('adapter.denyStatusCode() returns 403 for Windsurf', () => {
    expect(route(WINDSURF_PAYLOAD)!.adapter.denyStatusCode()).toBe(403);
  });
});

// ── Registry ──────────────────────────────────────────────────────────────────

describe('registeredAdapters()', () => {
  it('lists all known adapter names', () => {
    const names = registeredAdapters();
    expect(names).toContain('claude-code');
    expect(names).toContain('cursor');
    expect(names).toContain('windsurf');
  });
});
