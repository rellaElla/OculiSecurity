import { TemplateName } from './services/local-policy-templates';
export interface InitOpts {
    cwd?: string;
}
export interface InitResult {
    path: string;
    created: boolean;
    template: TemplateName;
}
export declare function runInit(templateName: string, opts?: InitOpts): InitResult;
//# sourceMappingURL=init.d.ts.map