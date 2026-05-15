import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Default data directory: ~/.oculi/ */
export function defaultDataDir(): string {
  return path.join(os.homedir(), '.oculi');
}

/**
 * Ensure `dir` exists and is locked down to the current user (chmod 700).
 * Returns the absolute path. Idempotent.
 */
export function ensureDataDir(dir: string): string {
  const abs = path.resolve(dir);
  fs.mkdirSync(abs, { recursive: true, mode: 0o700 });
  // mkdir's `mode` is masked by umask on existing dirs; chmod is the
  // authoritative fix when the dir was created earlier with a wider mode.
  try {
    fs.chmodSync(abs, 0o700);
  } catch {
    // Best-effort — chmod can fail on Windows / weird filesystems.
  }
  return abs;
}
