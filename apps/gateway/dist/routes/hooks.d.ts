import { FastifyInstance } from 'fastify';
import { PolicyService } from '../services/policy';
import { AuditService } from '../services/audit';
import { RateLimiter } from '../services/ratelimit';
interface HooksRouteContext {
    policy: PolicyService;
    audit: AuditService;
    rateLimiter: RateLimiter;
}
export declare function registerHooksRoute(app: FastifyInstance, ctx: HooksRouteContext): void;
export {};
