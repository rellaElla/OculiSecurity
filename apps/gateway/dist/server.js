"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildServer = buildServer;
const path_1 = __importDefault(require("path"));
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const static_1 = __importDefault(require("@fastify/static"));
const auth_1 = require("./middleware/auth");
const health_1 = require("./routes/health");
const call_1 = require("./routes/call");
const admin_1 = require("./routes/admin");
const events_1 = require("./routes/events");
const hooks_1 = require("./routes/hooks");
const openai_tools_1 = require("./routes/openai-tools");
const mcp_1 = require("./routes/mcp");
const policy_1 = require("./services/policy");
const audit_1 = require("./services/audit");
const upstream_1 = require("./services/upstream");
const ratelimit_1 = require("./services/ratelimit");
const policy_store_1 = require("./services/policy-store");
const tool_executor_1 = require("./services/tool-executor");
async function buildServer(config) {
    const app = (0, fastify_1.default)({
        logger: config.logLevel !== 'silent'
            ? { level: config.logLevel }
            : false,
        trustProxy: true, // needed for accurate request.ip behind Docker/nginx
    });
    // -----------------------------------------------------------------------
    // Plugins
    // -----------------------------------------------------------------------
    await app.register(cors_1.default, { origin: true });
    // Serve admin UI from public/
    const publicDir = path_1.default.join(__dirname, '..', 'public');
    await app.register(static_1.default, {
        root: publicDir,
        prefix: '/admin',
        maxAge: 0,
        immutable: false,
        setHeaders(res, filePath) {
            if (filePath.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
            }
        },
    });
    // -----------------------------------------------------------------------
    // Services
    // -----------------------------------------------------------------------
    const audit = new audit_1.AuditService(config);
    const policy = new policy_1.PolicyService(config);
    const policyStore = new policy_store_1.PolicyStore(config);
    const upstream = new upstream_1.UpstreamConnector(config);
    const rateLimiter = new ratelimit_1.RateLimiter(config.rateLimitCapacity, config.rateLimitRefillPerSecond);
    // Periodically clean up stale rate-limit buckets
    const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 60_000);
    cleanupInterval.unref(); // don't prevent process exit
    // Serve favicon at root for browsers
    app.get('/favicon.svg', (_req, reply) => {
        reply.type('image/svg+xml').sendFile('favicon.svg');
    });
    app.get('/favicon.ico', (_req, reply) => {
        reply.type('image/svg+xml').sendFile('favicon.svg');
    });
    // -----------------------------------------------------------------------
    // Auth middleware (all routes except /health and /admin static)
    // -----------------------------------------------------------------------
    (0, auth_1.registerAuthMiddleware)(app, config.jwtSecret);
    // -----------------------------------------------------------------------
    // Routes
    // -----------------------------------------------------------------------
    (0, health_1.registerHealthRoutes)(app);
    const executor = new tool_executor_1.ToolExecutor({ policy, audit, upstream, rateLimiter });
    (0, call_1.registerCallRoutes)(app, { policy, audit, upstream, rateLimiter });
    (0, openai_tools_1.registerOpenAIToolsRoutes)(app, { executor, upstream });
    (0, mcp_1.registerMcpRoutes)(app, { executor, upstream, jwtSecret: config.jwtSecret });
    (0, admin_1.registerAdminRoutes)(app, { audit, upstream, config, policyStore, policy });
    (0, events_1.registerEventsRoute)(app, { audit });
    (0, hooks_1.registerHooksRoute)(app, { policy, audit, rateLimiter });
    // -----------------------------------------------------------------------
    // 404 handler — SPA catch-all for /admin/* paths
    // -----------------------------------------------------------------------
    app.setNotFoundHandler((req, reply) => {
        if (req.method === 'GET' && req.url.startsWith('/admin/')) {
            reply.type('text/html').sendFile('index.html');
            return;
        }
        reply.code(404).send({ error: 'Not found' });
    });
    // -----------------------------------------------------------------------
    // Error handler
    // -----------------------------------------------------------------------
    app.setErrorHandler((error, _req, reply) => {
        app.log.error(error);
        if (error.statusCode === 400) {
            reply.code(400).send({ error: error.message, code: 'VALIDATION_ERROR' });
            return;
        }
        reply.code(500).send({ error: 'Internal server error' });
    });
    return {
        app,
        audit,
        rateLimiter,
        async close() {
            clearInterval(cleanupInterval);
            await app.close();
            audit.close();
            policyStore.close();
        },
    };
}
