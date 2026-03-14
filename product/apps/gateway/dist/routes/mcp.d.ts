import { FastifyInstance } from 'fastify';
import { UpstreamConnector } from '../services/upstream';
import { ToolExecutor } from '../services/tool-executor';
interface McpRouteContext {
    executor: ToolExecutor;
    upstream: UpstreamConnector;
    jwtSecret: string;
}
export declare function registerMcpRoutes(app: FastifyInstance, ctx: McpRouteContext): void;
export {};
//# sourceMappingURL=mcp.d.ts.map