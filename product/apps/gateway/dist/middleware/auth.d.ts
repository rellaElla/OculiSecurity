import { FastifyRequest, FastifyInstance } from 'fastify';
import { AuthenticatedActor } from '../types';
/**
 * Resolve an AuthenticatedActor from a request — used by routes that need
 * auth but handle it themselves (e.g. /mcp which also accepts ?token= for SSE).
 * Reads from request.actor (set by middleware) or falls back to the ?token=
 * query parameter (browsers can't set headers for SSE connections).
 */
export declare function resolveActor(request: FastifyRequest, jwtSecret: string): AuthenticatedActor | null;
declare module 'fastify' {
    interface FastifyRequest {
        actor: AuthenticatedActor;
    }
}
export declare function registerAuthMiddleware(app: FastifyInstance, jwtSecret: string): void;
//# sourceMappingURL=auth.d.ts.map