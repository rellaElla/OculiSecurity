/**
 * Demo Upstream: Filesystem MCP Server
 *
 * Accepts: POST /v1/call { tool, args, sessionId, actor }
 * Tools:   readFile, listDir, writeFile
 *
 * All file operations are sandboxed to DEMO_DATA_DIR (default: ./demo-data).
 * Path traversal is blocked at this layer too (defence in depth).
 */

import fs from 'fs';
import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';

const DEMO_DATA_DIR = path.resolve(
  process.env.FS_DEMO_DATA_DIR ?? path.join(process.cwd(), 'demo-data')
);
const PORT = parseInt(process.env.FS_PORT ?? '3001', 10);

// Ensure sandbox directory and seed demo files
function ensureDemoData(): void {
  if (!fs.existsSync(DEMO_DATA_DIR)) {
    fs.mkdirSync(DEMO_DATA_DIR, { recursive: true });
  }

  const helloPath = path.join(DEMO_DATA_DIR, 'hello.txt');
  if (!fs.existsSync(helloPath)) {
    fs.writeFileSync(helloPath, 'Hello from the Oculi Security Gateway demo!\n');
  }

  const secretPath = path.join(DEMO_DATA_DIR, 'config.json');
  if (!fs.existsSync(secretPath)) {
    fs.writeFileSync(
      secretPath,
      JSON.stringify({
        appName: 'demo',
        version: '1.0.0',
        password: 'super-secret-should-be-redacted',
        apiKey: 'sk-demo-key-also-redacted',
        allowedHosts: ['localhost'],
      }, null, 2)
    );
  }
}

/** Resolve and validate a path stays within the sandbox */
function resolveSandboxPath(userPath: string): string {
  // Reject obvious traversal
  const forbidden = ['../', '..\\', '%2e%2e', '%252e'];
  for (const pattern of forbidden) {
    if (userPath.toLowerCase().includes(pattern.toLowerCase())) {
      throw new Error(`Path traversal detected: '${userPath}'`);
    }
  }

  const resolved = path.resolve(DEMO_DATA_DIR, userPath);

  // Final check: resolved path must be inside sandbox
  if (!resolved.startsWith(DEMO_DATA_DIR + path.sep) && resolved !== DEMO_DATA_DIR) {
    throw new Error(`Path '${userPath}' escapes sandbox`);
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

interface ToolArgs { [key: string]: unknown }

function handleReadFile(args: ToolArgs): unknown {
  const filePath = args.path as string;
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('readFile requires args.path (string)');
  }

  const resolved = resolveSandboxPath(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: '${filePath}'`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: '${filePath}'`);
  }

  const content = fs.readFileSync(resolved, 'utf8');
  return { path: filePath, content, size: stat.size };
}

function handleListDir(args: ToolArgs): unknown {
  const dirPath = (args.path as string) ?? '.';
  const resolved = resolveSandboxPath(dirPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: '${dirPath}'`);
  }

  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  return {
    path: dirPath,
    entries: entries.map((e) => ({
      name: e.name,
      type: e.isDirectory() ? 'directory' : 'file',
    })),
  };
}

function handleWriteFile(args: ToolArgs): unknown {
  const filePath = args.path as string;
  const content = args.content as string;

  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('writeFile requires args.path (string)');
  }
  if (typeof content !== 'string') {
    throw new Error('writeFile requires args.content (string)');
  }

  const resolved = resolveSandboxPath(filePath);

  // Ensure parent directory exists (within sandbox only)
  const dir = path.dirname(resolved);
  if (!dir.startsWith(DEMO_DATA_DIR)) {
    throw new Error('Cannot create directories outside sandbox');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(resolved, content, 'utf8');

  return { path: filePath, written: content.length, success: true };
}

// ---------------------------------------------------------------------------
// Server factory (exported for tests)
// ---------------------------------------------------------------------------

export function buildFsServer(): FastifyInstance {
  ensureDemoData();

  const app = Fastify({
    logger: process.env.LOG_LEVEL
      ? { level: process.env.LOG_LEVEL }
      : false,
  });

  app.post<{ Body: { tool: string; args: ToolArgs; sessionId?: string; actor?: string } }>(
    '/v1/call',
    async (request, reply) => {
      const { tool, args = {} } = request.body;

      try {
        let result: unknown;

        switch (tool) {
          case 'readFile':
            result = handleReadFile(args);
            break;
          case 'listDir':
            result = handleListDir(args);
            break;
          case 'writeFile':
            result = handleWriteFile(args);
            break;
          default:
            reply.code(400).send({ error: `Unknown tool: '${tool}'` });
            return;
        }

        reply.send({ tool, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(400).send({ error: message });
      }
    }
  );

  app.get('/health', async (_req, reply) => {
    reply.send({ status: 'ok', service: 'demo-upstream-fs', sandboxDir: DEMO_DATA_DIR });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Standalone entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const server = buildFsServer();

  server.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
    if (err) { console.error(err); process.exit(1); }
    console.log(`[demo-fs] Filesystem upstream listening on :${PORT}`);
    console.log(`[demo-fs] Sandbox: ${DEMO_DATA_DIR}`);
    console.log(`[demo-fs] Tools: readFile, listDir, writeFile`);
  });
}
