export interface InstallOpts {
    global: boolean;
    dryRun: boolean;
    cwd?: string;
}
export interface InstallResult {
    path: string;
    added: string[];
    removed: string[];
}
export declare function installCursor(opts: InstallOpts): InstallResult;
export declare function uninstallCursor(opts: InstallOpts): InstallResult;
