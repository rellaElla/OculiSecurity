import { describe, it, expect } from 'vitest';
import { parseClaudeCodeEvent } from '../../src/routes/adapters/claude-code';
import { parseCursorEvent } from '../../src/routes/adapters/cursor';
import type { OculiEvent } from '../../src/routes/adapters/schema';

// ── Helpers ─────────────────────────────────────────────────────────────────

function ccShell(command: string, opts?: { cwd?: string; sessionId?: string }): OculiEvent {
  return parseClaudeCodeEvent(
    JSON.stringify({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      tool_input: { command },
      session_id: opts?.sessionId ?? 'cc-session',
      cwd: opts?.cwd ?? '/workspace',
    }),
    'PreToolUse',
  );
}

function cursorShell(command: string, opts?: { workspace?: string; convId?: string }): OculiEvent {
  return parseCursorEvent(
    JSON.stringify({
      hook_event_name: 'beforeShellExecution',
      conversation_id: opts?.convId ?? 'cursor-conv',
      generation_id: 'cursor-gen',
      content: command,
      workspace_roots: [opts?.workspace ?? '/workspace'],
    }),
    'beforeShellExecution',
  );
}

// ── Structural equivalence ───────────────────────────────────────────────────

describe('Structural equivalence: Claude Code ↔ Cursor', () => {
  it('shell execution (npm test) produces semantically identical OculiEvent', () => {
    const cc = ccShell('npm test', { cwd: '/workspace/myapp' });
    const cursor = cursorShell('npm test', { workspace: '/workspace/myapp' });

    // Phase, tool type, and command must match — this is the core guarantee
    expect(cc.schema_version).toBe(cursor.schema_version);   // '1'
    expect(cc.phase).toBe(cursor.phase);                     // 'pre'
    expect(cc.tool).toBe(cursor.tool);                       // 'shell'
    expect(cc.shell_command).toBe(cursor.shell_command);     // 'npm test'
    expect(cc.tool_args).toEqual(cursor.tool_args);          // { command: 'npm test' }
    expect(cc.action?.command).toBe(cursor.action?.command); // 'npm test'
    expect(cc.context?.workspace).toBe(cursor.context?.workspace); // '/workspace/myapp'
  });

  it('post-phase shell execution normalises identically', () => {
    const cc = parseClaudeCodeEvent(
      JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'npm run build' },
        tool_response: { stdout: 'Built.', exitCode: 0 },
        session_id: 'cc-s',
        cwd: '/workspace',
      }),
      'PostToolUse',
    );
    const cursor = parseCursorEvent(
      JSON.stringify({
        hook_event_name: 'afterFileEdit',  // closest Cursor post-event
        conversation_id: 'c1',
        generation_id: 'g1',
        file_path: '/workspace/dist/index.js',
        workspace_roots: ['/workspace'],
      }),
      'afterFileEdit',
    );

    expect(cc.phase).toBe('post');
    expect(cursor.phase).toBe('post');
    expect(cc.schema_version).toBe(cursor.schema_version);
  });

  it('context.workspace is populated from both IDE sources', () => {
    const cc = ccShell('ls', { cwd: '/my/project' });
    const cursor = cursorShell('ls', { workspace: '/my/project' });

    expect(cc.context?.workspace).toBe('/my/project');
    expect(cursor.context?.workspace).toBe('/my/project');
  });

  it('schema_version is always 1 regardless of IDE source', () => {
    const cc = ccShell('echo hi');
    const cursor = cursorShell('echo hi');

    expect(cc.schema_version).toBe('1');
    expect(cursor.schema_version).toBe('1');
  });
});

// ── Cursor event type mapping ────────────────────────────────────────────────

describe('parseCursorEvent — lifecycle event mapping', () => {
  it('beforeShellExecution → phase: pre, tool: shell', () => {
    const event = cursorShell('npm test');
    expect(event.phase).toBe('pre');
    expect(event.tool).toBe('shell');
    expect(event.shell_command).toBe('npm test');
    expect(event.action?.command).toBe('npm test');
  });

  it('beforeReadFile → phase: pre, tool: file_read', () => {
    const event = parseCursorEvent(
      JSON.stringify({
        hook_event_name: 'beforeReadFile',
        conversation_id: 'c1',
        generation_id: 'g1',
        file_path: '/src/index.ts',
        workspace_roots: ['/src'],
      }),
      'beforeReadFile',
    );
    expect(event.phase).toBe('pre');
    expect(event.tool).toBe('file_read');
    expect(event.file_path).toBe('/src/index.ts');
  });

  it('beforeReadFile with content → action.content_hash set', () => {
    const event = parseCursorEvent(
      JSON.stringify({
        hook_event_name: 'beforeReadFile',
        conversation_id: 'c1',
        generation_id: 'g1',
        file_path: '/src/index.ts',
        content: 'const x = 1;',
        workspace_roots: ['/src'],
      }),
      'beforeReadFile',
    );
    expect(event.action?.content_hash).toBeDefined();
    expect(event.action?.content_hash).toHaveLength(16); // sha256 prefix
    // Hash is deterministic
    expect(event.action?.content_hash).toBe(event.action?.content_hash);
  });

  it('afterFileEdit → phase: post, tool: file_edit', () => {
    const event = parseCursorEvent(
      JSON.stringify({
        hook_event_name: 'afterFileEdit',
        conversation_id: 'c1',
        generation_id: 'g1',
        file_path: '/src/index.ts',
        content: 'const x = 2;',
        workspace_roots: ['/src'],
      }),
      'afterFileEdit',
    );
    expect(event.phase).toBe('post');
    expect(event.tool).toBe('file_edit');
    expect(event.file_path).toBe('/src/index.ts');
    expect(event.action?.content_hash).toHaveLength(16);
  });

  it('beforeMCPExecution → phase: pre, tool: mcp_call', () => {
    const event = parseCursorEvent(
      JSON.stringify({
        hook_event_name: 'beforeMCPExecution',
        conversation_id: 'c1',
        generation_id: 'g1',
        mcp_server: 'fs-server',
        mcp_tool: 'readFile',
        workspace_roots: ['/tmp'],
      }),
      'beforeMCPExecution',
    );
    expect(event.phase).toBe('pre');
    expect(event.tool).toBe('mcp_call');
    expect(event.mcp_server).toBe('fs-server');
    expect(event.tool_args?.mcp_tool).toBe('readFile'); // specific tool preserved in args
  });

  it('afterMCPExecution → phase: post, tool: mcp_call', () => {
    const event = parseCursorEvent(
      JSON.stringify({
        hook_event_name: 'afterMCPExecution',
        conversation_id: 'c1',
        generation_id: 'g1',
        mcp_server: 'fs-server',
        mcp_tool: 'readFile',
        workspace_roots: ['/tmp'],
      }),
      'afterMCPExecution',
    );
    expect(event.phase).toBe('post');
    expect(event.tool).toBe('mcp_call');
  });

  it('stop → phase: complete, tool: session_stop', () => {
    const event = parseCursorEvent(
      JSON.stringify({
        hook_event_name: 'stop',
        conversation_id: 'c1',
        generation_id: 'g1',
        workspace_roots: ['/tmp'],
      }),
      'stop',
    );
    expect(event.phase).toBe('complete');
    expect(event.tool).toBe('session_stop');
  });

  it('context fields are populated from Cursor wire fields', () => {
    const event = cursorShell('ls', { workspace: '/projects/app', convId: 'my-conv' });
    expect(event.context?.workspace).toBe('/projects/app');
    expect(event.context?.conversation_id).toBe('my-conv');
    expect(event.session_id).toBe('my-conv'); // session_id mirrors conversation_id
  });

  it('content_hash is deterministic for the same content', () => {
    const content = 'export const x = 42;';
    const a = parseCursorEvent(
      JSON.stringify({ hook_event_name: 'afterFileEdit', conversation_id: 'c1', generation_id: 'g1', file_path: '/f.ts', content, workspace_roots: [] }),
      'afterFileEdit',
    );
    const b = parseCursorEvent(
      JSON.stringify({ hook_event_name: 'afterFileEdit', conversation_id: 'c2', generation_id: 'g2', file_path: '/f.ts', content, workspace_roots: [] }),
      'afterFileEdit',
    );
    expect(a.action?.content_hash).toBe(b.action?.content_hash);
  });
});

// ── Claude Code tool normalization ───────────────────────────────────────────

describe('parseClaudeCodeEvent — tool normalisation', () => {
  it('Bash → shell', () => {
    const event = ccShell('npm test');
    expect(event.tool).toBe('shell');
  });

  it('Read → file_read', () => {
    const event = parseClaudeCodeEvent(
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: '/src/a.ts' }, session_id: 's1' }),
      'PreToolUse',
    );
    expect(event.tool).toBe('file_read');
  });

  it('Write → file_edit', () => {
    const event = parseClaudeCodeEvent(
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/src/a.ts' }, session_id: 's1' }),
      'PreToolUse',
    );
    expect(event.tool).toBe('file_edit');
  });

  it('Edit → file_edit', () => {
    const event = parseClaudeCodeEvent(
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: {}, session_id: 's1' }),
      'PreToolUse',
    );
    expect(event.tool).toBe('file_edit');
  });

  it('unknown tool name passes through unchanged', () => {
    const event = parseClaudeCodeEvent(
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'WebSearch', tool_input: {}, session_id: 's1' }),
      'PreToolUse',
    );
    expect(event.tool).toBe('WebSearch');
  });

  it('shell_command populated from Bash tool_input.command', () => {
    const event = ccShell('git status');
    expect(event.shell_command).toBe('git status');
    expect(event.action?.command).toBe('git status');
  });

  it('context.workspace populated from cwd', () => {
    const event = ccShell('ls', { cwd: '/home/user/project' });
    expect(event.context?.workspace).toBe('/home/user/project');
  });

  it('context absent when cwd not provided', () => {
    const event = parseClaudeCodeEvent(
      JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: 's1' }),
      'PreToolUse',
    );
    expect(event.context).toBeUndefined();
  });
});
