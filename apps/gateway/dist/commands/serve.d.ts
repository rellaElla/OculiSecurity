import { AppConfig } from '../config';
export interface ServeOpts {
    port: number;
    bind: string;
    dataDir: string;
    /** When undefined, no-auth mode (synthetic admin actor). */
    auth?: string;
    /** When undefined, OPA is disabled and the built-in fallback policy runs. */
    opaUrl?: string;
    verbose?: boolean;
}
/**
 * Build an AppConfig from serve opts + sensible defaults.
 *
 * Zero-config localhost: no auth, no OPA, no rate limit, no upstreams.
 * Non-localhost bind: same defaults except rate limit and auth are required.
 */
export declare function buildServeConfig(opts: ServeOpts): AppConfig;
/**
 * Validate serve opts. Throws an Error with a CLI-ready message on misuse.
 * Caller is responsible for printing the message to stderr and exiting.
 */
export declare function validateServeOpts(opts: ServeOpts): void;
/**
 * Start the gateway. Foreground only — blocks on app.listen and SIGINT/SIGTERM.
 */
export declare function runServe(opts: ServeOpts): Promise<void>;
