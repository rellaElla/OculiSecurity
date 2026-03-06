/**
 * Starter policy templates for `oculi init`.
 *
 * Each template is a raw YAML string (not an object) so we can include
 * comments that explain the format to the user.
 */
export declare const TEMPLATE_NAMES: readonly ["minimal", "standard", "strict"];
export type TemplateName = (typeof TEMPLATE_NAMES)[number];
export declare const templates: Record<TemplateName, string>;
//# sourceMappingURL=local-policy-templates.d.ts.map