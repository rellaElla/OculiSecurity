import { FastifyInstance } from 'fastify';
import { AppConfig } from '../config';
import { AuditService } from '../services/audit';
import { UpstreamConnector } from '../services/upstream';
import { PolicyStore } from '../services/policy-store';
import { PolicyService } from '../services/policy';
interface AdminRouteContext {
    audit: AuditService;
    upstream: UpstreamConnector;
    config: AppConfig;
    policyStore: PolicyStore;
    policy: PolicyService;
}
export declare function registerAdminRoutes(app: FastifyInstance, ctx: AdminRouteContext): void;
export {};
//# sourceMappingURL=admin.d.ts.map