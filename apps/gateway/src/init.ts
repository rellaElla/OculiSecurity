import * as fs from 'fs';
import * as path from 'path';
import { templates, TEMPLATE_NAMES, TemplateName } from './services/local-policy-templates';

export interface InitOpts {
  cwd?: string;
}

export interface InitResult {
  path: string;
  created: boolean;
  template: TemplateName;
}

export function runInit(templateName: string, opts: InitOpts = {}): InitResult {
  if (!TEMPLATE_NAMES.includes(templateName as TemplateName)) {
    throw new Error(
      `Unknown template '${templateName}'. Choose one of: ${TEMPLATE_NAMES.join(', ')}`,
    );
  }

  const template = templateName as TemplateName;
  const base = opts.cwd ?? process.cwd();
  const policyPath = path.join(base, '.oculi', 'policy.yaml');

  if (fs.existsSync(policyPath)) {
    return { path: policyPath, created: false, template };
  }

  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  fs.writeFileSync(policyPath, templates[template], 'utf8');

  return { path: policyPath, created: true, template };
}
