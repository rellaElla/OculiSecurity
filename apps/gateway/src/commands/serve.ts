import * as path from 'path';
import * as os from 'os';
import { AppConfig } from '../config';
import { buildServer } from '../server';
import { ensureDataDir } from '../services/data-dir';
import { findTelemetryLog } from '../services/telemetry-log';

export interface ServeOpts {
  port: number;
  bind: string;
  dataDir: string;
  /** When undefined, no-auth mode (synthetic admin actor). */
  auth?: string;
  /** When undefined, OPA is disabled and the built-in fallback policy runs. */
  opaUrl?: string;
}

const LOCALHOST = new Set(['127.0.0.1', 'localhost', '::1']);
function isLocalhost(addr: string): boolean {
  return LOCALHOST.has(addr);
}

/**
 * Build an AppConfig from serve opts + sensible defaults.
 *
 * Zero-config localhost: no auth, no OPA, no rate limit, no upstreams.
 * Non-localhost bind: same defaults except rate limit and auth are required.
 */
export function buildServeConfig(opts: ServeOpts): AppConfig {
  const local = isLocalhost(opts.bind);
  return {
    port: opts.port,
    jwtSecret: opts.auth ?? '',
    opaUrl: opts.opaUrl ?? 'http://localhost:8181',
    opaEnabled: !!opts.opaUrl,
    dbPath: path.join(opts.dataDir, 'oculi.db'),
    storeFullArgs: false,
    upstreams: [],
    rateLimitCapacity: local ? 0 : 10,
    rateLimitRefillPerSecond: local ? 0 : 2,
    logLevel: 'info',
  };
}

/**
 * Validate serve opts. Throws an Error with a CLI-ready message on misuse.
 * Caller is responsible for printing the message to stderr and exiting.
 */
export function validateServeOpts(opts: ServeOpts): void {
  const local = isLocalhost(opts.bind);
  const envAuth = process.env.OCULI_GATEWAY_TOKEN;
  const effectiveAuth = opts.auth ?? envAuth;

  if (!local) {
    if (!effectiveAuth) {
      throw new Error(
        `Binding to ${opts.bind} requires authentication.\n` +
          'Set --auth <secret> (≥32 chars) or the OCULI_GATEWAY_TOKEN env var.\n' +
          'Refusing to start an unauthenticated gateway on a non-localhost interface.',
      );
    }
    if (effectiveAuth.length < 32) {
      throw new Error(
        '--auth secret must be at least 32 characters of high-entropy data.\n' +
          'Generate one with: openssl rand -hex 32',
      );
    }
  }
  // If the user supplied --auth on localhost, honor it but don't require length —
  // we treat it as advanced usage.
}

interface ListenError extends Error {
  code?: string;
}

/**
 * Start the gateway. Foreground only — blocks on app.listen and SIGINT/SIGTERM.
 */
export async function runServe(opts: ServeOpts): Promise<void> {
  try {
    validateServeOpts(opts);
  } catch (err) {
    process.stderr.write(`oculi: ${(err as Error).message}\n`);
    process.exit(1);
  }

  ensureDataDir(opts.dataDir);

  // OCULI_GATEWAY_TOKEN env var is an alternative way to provide --auth.
  // Merge here so the rest of the code doesn't have to know about the env var.
  const auth = opts.auth ?? process.env.OCULI_GATEWAY_TOKEN;
  const config = buildServeConfig({ ...opts, auth });

  const { app, audit, close } = await buildServer(config);

  // Backfill the dashboard's sqlite from the CLI's telemetry.jsonl. Without
  // this, events generated while no gateway was running are invisible at
  // /admin even though `oculi tail` shows them. Checkpointed so re-runs of
  // serve are no-ops.
  const telemetryPath = findTelemetryLog();
  if (telemetryPath) {
    try {
      const r = audit.replayFromTelemetry(telemetryPath);
      if (r.inserted > 0 || r.rotated) {
        const tildePath = telemetryPath.startsWith(os.homedir())
          ? '~' + telemetryPath.slice(os.homedir().length)
          : telemetryPath;
        const suffix = r.skipped > 0 ? ` (${r.skipped} malformed lines skipped)` : '';
        const rotateNote = r.rotated ? ' [file rotated — replayed from start]' : '';
        process.stdout.write(
          `Replayed ${r.inserted} events from ${tildePath}${rotateNote}${suffix}\n`,
        );
      }
    } catch (err) {
      process.stderr.write(
        `oculi: telemetry replay failed (${(err as Error).message}) — continuing\n`,
      );
    }
  }

  try {
    // listenTextResolver suppresses Fastify's default "Server listening at …"
    // info-level log so our own banner is the only thing the user sees.
    await app.listen({
      port: config.port,
      host: opts.bind,
      listenTextResolver: () => '',
    });
  } catch (err) {
    const e = err as ListenError;
    if (e.code === 'EADDRINUSE') {
      process.stderr.write(
        `oculi: port ${config.port} is already in use.\n` +
          `Try \`oculi serve --port <other-port>\` or stop the process bound to ${config.port}.\n`,
      );
      await close();
      process.exit(2);
    }
    process.stderr.write(`oculi: failed to start gateway: ${e.message}\n`);
    await close();
    process.exit(1);
  }

  const url = `http://${opts.bind === '0.0.0.0' ? 'localhost' : opts.bind}:${config.port}`;
  process.stdout.write(`Oculi gateway listening on ${opts.bind}:${config.port}\n`);
  process.stdout.write(`  Dashboard:  ${url}/admin/\n`);
  process.stdout.write(`  Data dir:   ${opts.dataDir}\n`);
  process.stdout.write(`  Auth:       ${auth ? 'enabled (JWT)' : 'disabled (local-dev)'}\n`);
  process.stdout.write(
    `  Rate limit: ${config.rateLimitCapacity === 0 ? 'off' : `${config.rateLimitCapacity} cap / ${config.rateLimitRefillPerSecond}/s`}\n`,
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, async () => {
      process.stdout.write(`\noculi: received ${signal}, shutting down...\n`);
      await close();
      process.exit(0);
    });
  }
}
