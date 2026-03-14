import { AppConfig } from '../config';
import { UpstreamCallRequest, UpstreamConfig } from '../types';
export interface UpstreamResult {
    data: unknown;
    latencyMs: number;
}
export declare class UpstreamConnector {
    private readonly registry;
    constructor(config: AppConfig);
    getConfig(upstreamId: string): UpstreamConfig | undefined;
    listUpstreams(): UpstreamConfig[];
    call(upstreamId: string, body: UpstreamCallRequest): Promise<UpstreamResult>;
}
export declare class UpstreamError extends Error {
    readonly statusCode: number;
    readonly latencyMs: number;
    constructor(message: string, statusCode: number, latencyMs: number);
}
//# sourceMappingURL=upstream.d.ts.map