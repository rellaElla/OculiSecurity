import path from 'path';
import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { AppConfig } from './config';
import { registerAuthMiddleware } from './middleware/auth';
import { registerHealthRoutes } from './routes/health';
import { registerCallRoutes } from './routes/call';
import { registerAdminRoutes } from './routes/admin';
import { registerEventsRoute } from './routes/events';
import { registerHooksRoute } from './routes/hooks';
import { registerOpenAIToolsRoutes } from './routes/openai-tools';
import { registerMcpRoutes } from './routes/mcp';
import { PolicyService } from './services/policy';
import { AuditService } from './services/audit';
import { UpstreamConnector } from './services/upstream';
import { RateLimiter } from './services/ratelimit';
import { PolicyStore } from './services/policy-store';
import { ToolExecutor } from './services/tool-executor';

export interface GatewayServer {
  app: FastifyInstance;
  audit: AuditService;
  rateLimiter: RateLimiter;
  close: () => Promise<void>;
}

export async function buildServer(config: AppConfig): Promise<GatewayServer> {
  const app = Fastify({
    logger:
      config.logLevel !== 'silent'
        ? { level: config.logLevel }
        : false,
    trustProxy: true, // needed for accurate request.ip behind Docker/nginx
  });

  // -----------------------------------------------------------------------
  // Plugins
  // -----------------------------------------------------------------------
  await app.register(cors, { origin: true });

  // Serve admin UI from public/
  const publicDir = path.join(__dirname, '..', 'public');
  await app.register(staticFiles, {
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
  const audit = new AuditService(config);
  const policy = new PolicyService(config);
  const policyStore = new PolicyStore(config);
  const upstream = new UpstreamConnector(config);
  const rateLimiter = new RateLimiter(
    config.rateLimitCapacity,
    config.rateLimitRefillPerSecond
  );

  // Periodically clean up stale rate-limit buckets
  const cleanupInterval = setInterval(() => rateLimiter.cleanup(), 60_000);
  cleanupInterval.unref(); // don't prevent process exit

  // -----------------------------------------------------------------------
  // Auth middleware (all routes except /health and /admin static)
  // -----------------------------------------------------------------------
  registerAuthMiddleware(app, config.jwtSecret);

  // -----------------------------------------------------------------------
  // Routes
  // -----------------------------------------------------------------------
  registerHealthRoutes(app);

  const executor = new ToolExecutor({ policy, audit, upstream, rateLimiter });

  registerCallRoutes(app, { policy, audit, upstream, rateLimiter });

  registerOpenAIToolsRoutes(app, { executor, upstream });

  registerMcpRoutes(app, { executor, upstream, jwtSecret: config.jwtSecret });

  registerAdminRoutes(app, { audit, upstream, config, policyStore, policy });

  registerEventsRoute(app, { audit });

  registerHooksRoute(app, { policy, audit, rateLimiter });

  // -----------------------------------------------------------------------
  // 404 handler
  // -----------------------------------------------------------------------
  app.setNotFoundHandler((_req, reply) => {
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
