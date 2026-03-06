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
export declare function installClaudeCode(opts: InstallOpts): InstallResult;
export declare function uninstallClaudeCode(opts: InstallOpts): InstallResult;
//# sourceMappingURL=claude-code.d.ts.map