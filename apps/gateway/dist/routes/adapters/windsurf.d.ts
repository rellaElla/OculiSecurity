import { OculiEvent } from './schema';
export declare function detect(body: Record<string, unknown>): boolean;
export declare function normalize(body: Record<string, unknown>): OculiEvent;
export declare function formatAllow(_event: OculiEvent): string;
export declare function formatDeny(reason: string, _event: OculiEvent): string;
export declare function denyStatusCode(): number;
