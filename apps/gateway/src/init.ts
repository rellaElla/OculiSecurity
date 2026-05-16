import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { templates } from './services/local-policy-templates';

export interface InitOpts {
  /** Override the home directory (tests only). Production callers should omit this. */
  home?: string;
}

export interface InitResult {
  path: string;
  created: boolean;
}

export function runInit(opts: InitOpts = {}): InitResult {
  const base = opts.home ?? os.homedir();
  const policyPath = path.join(base, '.oculi', 'policy.yaml');

  if (fs.existsSync(policyPath)) {
    return { path: policyPath, created: false };
  }

  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  fs.writeFileSync(policyPath, templates.standard, 'utf8');

  return { path: policyPath, created: true };
}
