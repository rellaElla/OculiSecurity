import { FastifyInstance } from 'fastify';
import { AuditService } from '../services/audit';
interface EventsRouteContext {
    audit: AuditService;
}
export declare function registerEventsRoute(app: FastifyInstance, ctx: EventsRouteContext): void;
export {};
//# sourceMappingURL=events.d.ts.map