"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveActor = resolveActor;
exports.registerAuthMiddleware = registerAuthMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
/**
 * Resolve an AuthenticatedActor from a request — used by routes that need
 * auth but handle it themselves (e.g. /mcp which also accepts ?token= for SSE).
 * Reads from request.actor (set by middleware) or falls back to the ?token=
 * query parameter (browsers can't set headers for SSE connections).
 */
function resolveActor(request, jwtSecret) {
    if (request.actor?.actor)
        return request.actor;
    const query = request.query;
    const token = query.token;
    if (!token)
        return null;
    try {
        const payload = jsonwebtoken_1.default.verify(token, jwtSecret);
        if (!payload.actor || !payload.orgId || !Array.isArray(payload.roles))
            return null;
        return { sub: payload.sub, actor: payload.actor, orgId: payload.orgId, roles: payload.roles };
    }
    catch {
        return null;
    }
}
function registerAuthMiddleware(app, jwtSecret) {
    // Decorate request so TypeScript knows the property exists
    app.decorateRequest('actor', null);
    // Prehandler hook: runs on every request before route handlers
    app.addHook('preHandler', async (request, reply) => {
        // Skip auth for health check and all /admin static assets.
        // The admin HTML is served unauthenticated; the /admin/logs and /admin/upstreams
        // API routes enforce auth themselves via request.actor checks.
        if (request.url === '/health' ||
            request.url === '/favicon.ico' ||
            request.url === '/v1/events' ||
            request.url === '/v1/hooks') {
            return;
        }
        // For /admin and /mcp routes: parse JWT if present but don't require it.
        // /admin static assets need no auth; API routes check request.actor internally.
        // /mcp handles auth inside the route (also accepts ?token= for SSE browser connections).
        if (request.url.startsWith('/admin') || request.url.startsWith('/mcp')) {
            const header = request.headers['authorization'];
            if (header?.startsWith('Bearer ')) {
                try {
                    const p = jsonwebtoken_1.default.verify(header.slice(7), jwtSecret);
                    if (p.actor && p.orgId && Array.isArray(p.roles)) {
                        request.actor = { sub: p.sub, actor: p.actor, orgId: p.orgId, roles: p.roles };
                    }
                }
                catch { /* token invalid — continue without auth */ }
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
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(token, jwtSecret);
        }
        catch (err) {
            const message = err instanceof jsonwebtoken_1.default.TokenExpiredError
                ? 'Token has expired'
                : err instanceof jsonwebtoken_1.default.JsonWebTokenError
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
//# sourceMappingURL=auth.js.map