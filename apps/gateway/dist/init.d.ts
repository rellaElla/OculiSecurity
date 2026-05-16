export interface InitOpts {
    /** Override the home directory (tests only). Production callers should omit this. */
    home?: string;
}
export interface InitResult {
    path: string;
    created: boolean;
}
export declare function runInit(opts?: InitOpts): InitResult;
