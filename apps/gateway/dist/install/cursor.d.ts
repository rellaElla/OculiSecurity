export interface InstallOpts {
    /** Override the home directory (tests only). Production callers should omit this. */
    home?: string;
}
export interface InstallResult {
    path: string;
    added: string[];
    removed: string[];
}
export declare function installCursor(opts?: InstallOpts): InstallResult;
export declare function uninstallCursor(opts?: InstallOpts): InstallResult;
/** Does ~/.cursor/hooks.json still have any oculi-marked hook? */
export declare function hasOculiHooks(home?: string): boolean;
