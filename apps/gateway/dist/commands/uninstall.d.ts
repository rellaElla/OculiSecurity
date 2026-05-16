import { Agent } from '../install/detect';
export interface UninstallOpts {
    agent?: Agent;
    /** Override the home directory (tests only). Production callers should omit this. */
    home?: string;
}
export interface UninstallResult {
    exitCode: 0;
    removed: Partial<Record<Agent, string[]>>;
    policyRemoved: boolean;
    remainingAgents: Agent[];
}
export declare function runUninstall(opts?: UninstallOpts): UninstallResult;
