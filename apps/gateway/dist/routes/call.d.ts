import { FastifyInstance } from 'fastify';
import { PolicyService } from '../services/policy';
import { AuditService } from '../services/audit';
import { UpstreamConnector } from '../services/upstream';
import { RateLimiter } from '../services/ratelimit';
interface CallRouteContext {
    policy: PolicyService;
    audit: AuditService;
    upstream: UpstreamConnector;
    rateLimiter: RateLimiter;
}
export declare function registerCallRoutes(app: FastifyInstance, ctx: CallRouteContext): void;
export {};
