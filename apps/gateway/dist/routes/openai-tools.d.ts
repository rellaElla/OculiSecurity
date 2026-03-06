import { FastifyInstance } from 'fastify';
import { UpstreamConnector } from '../services/upstream';
import { ToolExecutor } from '../services/tool-executor';
interface OpenAIToolsRouteContext {
    executor: ToolExecutor;
    upstream: UpstreamConnector;
}
export declare function registerOpenAIToolsRoutes(app: FastifyInstance, ctx: OpenAIToolsRouteContext): void;
export {};
//# sourceMappingURL=openai-tools.d.ts.map