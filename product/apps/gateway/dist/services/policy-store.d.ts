import { AppConfig } from '../config';
export interface PolicyRecord {
    id: number;
    name: string;
    description: string;
    version: string;
    rego: string;
    updatedAt: string;
    updatedBy: string;
    createdAt: string;
    isActive: number;
}
export interface CreatePolicyInput {
    name: string;
    description?: string;
    version?: string;
    rego: string;
    updatedBy: string;
}
export interface UpdatePolicyInput {
    name?: string;
    description?: string;
    version?: string;
    rego?: string;
    updatedBy: string;
    isActive?: number;
}
export interface VisualRule {
    id: number;
    rule_id: string;
    tool: string | null;
    command_pattern: string | null;
    file_pattern: string | null;
    mcp_server: string | null;
    action: 'deny' | 'warn' | 'allow';
    description: string;
    enabled: number;
    priority: number;
    createdAt: string;
    updatedAt: string;
}
export interface CreateVisualRuleInput {
    rule_id: string;
    tool?: string;
    command_pattern?: string;
    file_pattern?: string;
    mcp_server?: string;
    action: 'deny' | 'warn' | 'allow';
    description?: string;
    enabled?: number;
    priority?: number;
}
export interface UpdateVisualRuleInput {
    rule_id?: string;
    tool?: string | null;
    command_pattern?: string | null;
    file_pattern?: string | null;
    mcp_server?: string | null;
    action?: 'deny' | 'warn' | 'allow';
    description?: string;
    enabled?: number;
    priority?: number;
}
export declare class PolicyStore {
    private readonly db;
    constructor(config: AppConfig);
    private initialize;
    private seed;
    list(): PolicyRecord[];
    getById(id: number): PolicyRecord | undefined;
    create(input: CreatePolicyInput): PolicyRecord;
    update(id: number, input: UpdatePolicyInput): PolicyRecord | undefined;
    duplicate(id: number): PolicyRecord | undefined;
    delete(id: number): boolean;
    private seedVisualRules;
    listVisualRules(): VisualRule[];
    getVisualRuleById(id: number): VisualRule | undefined;
    createVisualRule(input: CreateVisualRuleInput): VisualRule;
    updateVisualRule(id: number, input: UpdateVisualRuleInput): VisualRule | undefined;
    deleteVisualRule(id: number): boolean;
    close(): void;
}
//# sourceMappingURL=policy-store.d.ts.map