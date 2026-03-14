import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';
import { JWTPayload, AuthenticatedActor } from '../types';

/**
 * Resolve an AuthenticatedActor from a request — used by routes that need
 * auth but handle it themselves (e.g. /mcp which also accepts ?token= for SSE).
 * Reads from request.actor (set by middleware) or falls back to the ?token=
 * query parameter (browsers can't set headers for SSE connections).
 */
export function resolveActor(request: FastifyRequest, jwtSecret: string): AuthenticatedActor | null {
  if (request.actor?.actor) return request.actor;

  const query = request.query as Record<string, string | undefined>;
  const token = query.token;
  if (!token) return null;

  try {
    const payload = jwt.verify(token, jwtSecret) as JWTPayload;
    if (!payload.actor || !payload.orgId || !Array.isArray(payload.roles)) return null;
    return { sub: payload.sub, actor: payload.actor, orgId: payload.orgId, roles: payload.roles };
  } catch {
    return null;
  }
}

// Augment Fastify's Request type so auth data flows through the call chain
declare module 'fastify' {
  interface FastifyRequest {
    actor: AuthenticatedActor;
  }
}

export function registerAuthMiddleware(
  app: FastifyInstance,
  jwtSecret: string
): void {
  // Decorate request so TypeScript knows the property exists
  app.decorateRequest('actor', null);

  // Prehandler hook: runs on every request before route handlers
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health check and all /admin static assets.
    // The admin HTML is served unauthenticated; the /admin/logs and /admin/upstreams
    // API routes enforce auth themselves via request.actor checks.
    if (
      request.url === '/health' ||
      request.url === '/favicon.ico' ||
      request.url === '/favicon.svg' ||
      request.url === '/v1/events' ||
      request.url === '/v1/hooks'
    ) {
      return;
    }

    // For /admin and /mcp routes: parse JWT if present but don't require it.
    // /admin static assets need no auth; API routes check request.actor internally.
    // /mcp handles auth inside the route (also accepts ?token= for SSE browser connections).
    if (request.url.startsWith('/admin') || request.url.startsWith('/mcp')) {
      const header = request.headers['authorization'];
      if (header?.startsWith('Bearer ')) {
        try {
          const p = jwt.verify(header.slice(7), jwtSecret) as JWTPayload;
          if (p.actor && p.orgId && Array.isArray(p.roles)) {
            request.actor = { sub: p.sub, actor: p.actor, orgId: p.orgId, roles: p.roles };
          }
        } catch { /* token invalid — continue without auth */ }
      }
      return;
    }

    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.code(401).send({
        error: 'Missing or malformed Authorization header. Expected: Bearer <token>',
        code: 'MISSING_TOKEN',
      });
      return;
    }

    const token = authHeader.slice(7);

    let payload: JWTPayload;
    try {
      payload = jwt.verify(token, jwtSecret) as JWTPayload;
    } catch (err) {
      const message =
        err instanceof jwt.TokenExpiredError
          ? 'Token has expired'
          : err instanceof jwt.JsonWebTokenError
          ? 'Invalid token signature'
          : 'Token verification failed';

      reply.code(401).send({
        error: message,
        code: 'INVALID_TOKEN',
      });
      return;
    }

    // Validate required fields
    if (!payload.actor || !payload.orgId || !Array.isArray(payload.roles)) {
      reply.code(401).send({
        error: 'Token payload missing required fields (actor, orgId, roles)',
        code: 'MALFORMED_TOKEN',
      });
      return;
    }

    request.actor = {
      sub: payload.sub,
      actor: payload.actor,
      orgId: payload.orgId,
      roles: payload.roles,
    };
  });
}
