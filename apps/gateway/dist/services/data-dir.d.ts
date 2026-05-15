/** Default data directory: ~/.oculi/ */
export declare function defaultDataDir(): string;
/**
 * Ensure `dir` exists and is locked down to the current user (chmod 700).
 * Returns the absolute path. Idempotent.
 */
export declare function ensureDataDir(dir: string): string;
