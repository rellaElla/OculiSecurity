import type Database from 'better-sqlite3';
type DatabaseCtor = typeof Database;
export declare function loadSqlite(): DatabaseCtor;
export {};
