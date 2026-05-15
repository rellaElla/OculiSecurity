import type Database from 'better-sqlite3';

type DatabaseCtor = typeof Database;

let cached: DatabaseCtor | null = null;

export function loadSqlite(): DatabaseCtor {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cached = require('better-sqlite3') as DatabaseCtor;
    return cached;
  } catch {
    throw new Error(
      'better-sqlite3 is not installed. The Oculi gateway server requires a C++ toolchain to build. See https://oculisecurity.com/docs/gateway-install for setup, or use the CLI in local-policy-only mode.',
    );
  }
}
