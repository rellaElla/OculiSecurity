/**
 * Starter policy template for `oculi init`.
 *
 * Stored as a raw YAML string (not an object) so we can include comments
 * that explain the format to the user.
 */
export declare const TEMPLATE_NAMES: readonly ["standard"];
export type TemplateName = (typeof TEMPLATE_NAMES)[number];
export declare const templates: Record<TemplateName, string>;
