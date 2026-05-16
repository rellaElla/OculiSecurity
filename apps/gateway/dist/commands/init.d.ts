import { Agent } from '../install/detect';
export interface InitOpts {
    agent?: Agent;
    /** Override the home directory (tests only). Production callers should omit this. */
    home?: string;
}
export interface InitResult {
    exitCode: 0 | 1;
    policyPath: string | null;
    policyCreated: boolean;
    wired: Agent[];
    added: Partial<Record<Agent, string[]>>;
}
export declare function runInit(opts?: InitOpts): InitResult;
