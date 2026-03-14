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
    close(): void;
}
//# sourceMappingURL=policy-store.d.ts.map