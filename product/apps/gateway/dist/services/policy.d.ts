import { AppConfig } from '../config';
import { PolicyDecision, PolicyInput } from '../types';
export declare class PolicyService {
    private readonly opaUrl;
    private readonly opaEnabled;
    constructor(config: AppConfig);
    evaluate(input: PolicyInput): Promise<PolicyDecision>;
}
//# sourceMappingURL=policy.d.ts.map