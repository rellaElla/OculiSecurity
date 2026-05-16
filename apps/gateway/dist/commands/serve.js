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
exports.buildServeConfig = buildServeConfig;
exports.validateServeOpts = validateServeOpts;
exports.runServe = runServe;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const server_1 = require("../server");
const data_dir_1 = require("../services/data-dir");
const telemetry_log_1 = require("../services/telemetry-log");
const LOCALHOST = new Set(['127.0.0.1', 'localhost', '::1']);
function isLocalhost(addr) {
    return LOCALHOST.has(addr);
}
/**
 * Build an AppConfig from serve opts + sensible defaults.
 *
 * Zero-config localhost: no auth, no OPA, no rate limit, no upstreams.
 * Non-localhost bind: same defaults except rate limit and auth are required.
 */
function buildServeConfig(opts) {
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
        logLevel: opts.verbose ? 'info' : 'warn',
    };
}
/**
 * Validate serve opts. Throws an Error with a CLI-ready message on misuse.
 * Caller is responsible for printing the message to stderr and exiting.
 */
function validateServeOpts(opts) {
    const local = isLocalhost(opts.bind);
    const envAuth = process.env.OCULI_GATEWAY_TOKEN;
    const effectiveAuth = opts.auth ?? envAuth;
    if (!local) {
        if (!effectiveAuth) {
            throw new Error(`Binding to ${opts.bind} requires authentication.\n` +
                'Set --auth <secret> (≥32 chars) or the OCULI_GATEWAY_TOKEN env var.\n' +
                'Refusing to start an unauthenticated gateway on a non-localhost interface.');
        }
        if (effectiveAuth.length < 32) {
            throw new Error('--auth secret must be at least 32 characters of high-entropy data.\n' +
                'Generate one with: openssl rand -hex 32');
        }
    }
    // If the user supplied --auth on localhost, honor it but don't require length —
    // we treat it as advanced usage.
}
/**
 * Start the gateway. Foreground only — blocks on app.listen and SIGINT/SIGTERM.
 */
async function runServe(opts) {
    try {
        validateServeOpts(opts);
    }
    catch (err) {
        process.stderr.write(`oculi: ${err.message}\n`);
        process.exit(1);
    }
    (0, data_dir_1.ensureDataDir)(opts.dataDir);
    // OCULI_GATEWAY_TOKEN env var is an alternative way to provide --auth.
    // Merge here so the rest of the code doesn't have to know about the env var.
    const auth = opts.auth ?? process.env.OCULI_GATEWAY_TOKEN;
    const config = buildServeConfig({ ...opts, auth });
    const { app, audit, close } = await (0, server_1.buildServer)(config);
    // Backfill the dashboard's sqlite from the CLI's telemetry.jsonl. Without
    // this, events generated while no gateway was running are invisible at
    // /admin even though `oculi tail` shows them. Checkpointed so re-runs of
    // serve are no-ops.
    const telemetryPath = (0, telemetry_log_1.findTelemetryLog)();
    if (telemetryPath) {
        try {
            const r = audit.replayFromTelemetry(telemetryPath);
            if (r.inserted > 0 || r.rotated) {
                const tildePath = telemetryPath.startsWith(os.homedir())
                    ? '~' + telemetryPath.slice(os.homedir().length)
                    : telemetryPath;
                const suffix = r.skipped > 0 ? ` (${r.skipped} malformed lines skipped)` : '';
                const rotateNote = r.rotated ? ' [file rotated — replayed from start]' : '';
                process.stdout.write(`Replayed ${r.inserted} events from ${tildePath}${rotateNote}${suffix}\n`);
            }
        }
        catch (err) {
            process.stderr.write(`oculi: telemetry replay failed (${err.message}) — continuing\n`);
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
    }
    catch (err) {
        const e = err;
        if (e.code === 'EADDRINUSE') {
            process.stderr.write(`oculi: port ${config.port} is already in use.\n` +
                `Try \`oculi serve --port <other-port>\` or stop the process bound to ${config.port}.\n`);
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
    process.stdout.write(`  Rate limit: ${config.rateLimitCapacity === 0 ? 'off' : `${config.rateLimitCapacity} cap / ${config.rateLimitRefillPerSecond}/s`}\n`);
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, async () => {
            process.stdout.write(`\noculi: received ${signal}, shutting down...\n`);
            await close();
            process.exit(0);
        });
    }
}
