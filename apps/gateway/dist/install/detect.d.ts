export declare const AGENTS: readonly ["claude-code", "cursor"];
export type Agent = (typeof AGENTS)[number];
export declare const BINARIES: Record<Agent, string>;
export declare function isAgentInstalled(agent: Agent): boolean;
export declare function detectAgents(): Agent[];
