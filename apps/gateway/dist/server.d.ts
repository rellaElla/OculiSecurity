import { FastifyInstance } from 'fastify';
import { AppConfig } from './config';
import { AuditService } from './services/audit';
import { RateLimiter } from './services/ratelimit';
export interface GatewayServer {
    app: FastifyInstance;
    audit: AuditService;
    rateLimiter: RateLimiter;
    close: () => Promise<void>;
}
export declare function buildServer(config: AppConfig): Promise<GatewayServer>;
//# sourceMappingURL=server.d.ts.map