"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigValidationError = void 0;
exports.loadConfig = loadConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
/** Resolve ${ENV_VAR:-default} placeholders in strings */
function resolveEnvVars(str) {
    return str.replace(/\$\{(\w+)(?::-(.*?))?\}/g, (_, key, fallback) => {
        return process.env[key] ?? fallback ?? '';
    });
}
function loadUpstreams() {
    const configPath = path_1.default.join(process.cwd(), 'config', 'upstreams.yaml');
    if (!fs_1.default.existsSync(configPath)) {
        // Hardcoded defaults for when config file is absent (tests, Docker, etc.)
        return [
            {
                id: 'fs-server',
                name: 'Demo Filesystem Server',
                baseUrl: process.env.FS_SERVER_URL ?? 'http://localhost:3001',
                timeout: 5000,
                tools: ['readFile', 'listDir', 'writeFile'],
            },
            {
                id: 'http-server',
                name: 'Demo HTTP Fetch Server',
                baseUrl: process.env.HTTP_SERVER_URL ?? 'http://localhost:3002',
                timeout: 10000,
                tools: ['fetchUrl', 'postUrl'],
            },
        ];
    }
    // Lazy-require yaml to keep startup fast when file doesn't exist
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const YAML = require('yaml');
    const raw = fs_1.default.readFileSync(configPath, 'utf8');
    const parsed = YAML.parse(raw);
    return parsed.upstreams.map((u) => {
        if (u.id.includes('__')) {
            throw new Error(`Upstream id '${u.id}' must not contain '__' (reserved as tool name separator)`);
        }
        return {
            ...u,
            baseUrl: resolveEnvVars(u.baseUrl),
            tools: Array.isArray(u.tools) ? u.tools : [],
        };
    });
}
class ConfigValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigValidationError';
    }
}
exports.ConfigValidationError = ConfigValidationError;
const JWT_SECRET_REQUIRED = 'JWT_SECRET environment variable is required for the gateway server.\n' +
    '\n' +
    'The gateway uses JWT_SECRET to verify tokens issued by your upstream\n' +
    'authentication provider. It must match the secret your issuer uses to\n' +
    'sign tokens, and must be at least 32 characters of high-entropy data.\n' +
    '\n' +
    'Generate a new secret with:\n' +
    '  openssl rand -hex 32\n' +
    '\n' +
    'See https://docs.oculisecurity.com/gateway/configuration for details.';
function requireJwtSecret() {
    const v = process.env.JWT_SECRET;
    if (!v || v.length < 32) {
        throw new ConfigValidationError(JWT_SECRET_REQUIRED);
    }
    return v;
}
function loadConfig() {
    return {
        port: parseInt(process.env.PORT ?? '3000', 10),
        jwtSecret: requireJwtSecret(),
        opaUrl: process.env.OPA_URL ?? 'http://localhost:8181',
        opaEnabled: process.env.OPA_ENABLED !== 'false',
        dbPath: process.env.DB_PATH ?? path_1.default.join(process.cwd(), 'data', 'audit.db'),
        storeFullArgs: process.env.STORE_FULL_ARGS === 'true',
        upstreams: loadUpstreams(),
        rateLimitCapacity: parseInt(process.env.RATE_LIMIT_CAPACITY ?? '10', 10),
        rateLimitRefillPerSecond: parseFloat(process.env.RATE_LIMIT_REFILL ?? '2'),
        logLevel: process.env.LOG_LEVEL ?? 'info',
    };
}
