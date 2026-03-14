import { UpstreamConfig } from './types';
export interface AppConfig {
    port: number;
    jwtSecret: string;
    opaUrl: string;
    opaEnabled: boolean;
    dbPath: string;
    storeFullArgs: boolean;
    upstreams: UpstreamConfig[];
    rateLimitCapacity: number;
    rateLimitRefillPerSecond: number;
    logLevel: string;
}
export declare function loadConfig(): AppConfig;
//# sourceMappingURL=config.d.ts.map