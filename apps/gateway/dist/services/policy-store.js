"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PolicyStore = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sqlite_loader_1 = require("./sqlite-loader");
class PolicyStore {
    db;
    constructor(config) {
        const dir = path_1.default.dirname(config.dbPath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        const Ctor = (0, sqlite_loader_1.loadSqlite)();
        this.db = new Ctor(config.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initialize();
    }
    initialize() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS policies (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version     TEXT NOT NULL DEFAULT '1.0.0',
        rego        TEXT NOT NULL,
        updatedAt   TEXT NOT NULL,
        updatedBy   TEXT NOT NULL,
        createdAt   TEXT NOT NULL,
        isActive    INTEGER NOT NULL DEFAULT 1
      )
    `);
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS visual_rules (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id         TEXT NOT NULL UNIQUE,
        tool            TEXT,
        command_pattern TEXT,
        file_pattern    TEXT,
        mcp_server      TEXT,
        action          TEXT NOT NULL CHECK(action IN ('deny','warn','allow')),
        description     TEXT NOT NULL DEFAULT '',
        enabled         INTEGER NOT NULL DEFAULT 1,
        priority        INTEGER NOT NULL DEFAULT 0,
        createdAt       TEXT NOT NULL,
        updatedAt       TEXT NOT NULL
      )
    `);
        this.seed();
        this.seedVisualRules();
    }
    seed() {
        const count = this.db.prepare('SELECT COUNT(*) as cnt FROM policies').get();
        if (count.cnt > 0)
            return;
        const insert = this.db.prepare(`
      INSERT INTO policies (name, description, version, rego, updatedAt, updatedBy, createdAt, isActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
        const seedPolicies = [
            {
                name: 'Admin Full Access',
                description: 'Grants full access to users with the admin role',
                version: '1.2.3',
                rego: `package mcp.authz

default allow = false

# Allow admin role full access
allow {
    input.role == "admin"
}

# Allow developers to read-only tools
allow {
    input.role == "developer"
    input.tool == "readFile"
}

allow {
    input.role == "developer"
    input.tool == "listDir"
}`,
                updatedAt: '2026-02-25T10:30:00.000Z',
                updatedBy: 'admin@oculisecurity.com',
                createdAt: '2026-01-15T08:00:00.000Z',
            },
            {
                name: 'Developer Restricted',
                description: 'Standard policy with tool allowlists, dangerous pattern checks, role restrictions, and sensitive field redactions',
                version: '2.1.0',
                rego: `package gateway.authz

import future.keywords.if
import future.keywords.in

default allow := false

allow if {
    not missing_tool
    tool_allowed
    not dangerous_args
    not role_restricted
}

reason := "allowed" if { allow }
else := "tool not specified" if { missing_tool }
else := "tool not in allowlist for this upstream" if {
    not missing_tool
    not tool_allowed
}
else := "dangerous argument pattern detected" if {
    not missing_tool
    tool_allowed
    dangerous_args
}
else := "role restriction: insufficient permissions for write operations" if {
    not missing_tool
    tool_allowed
    not dangerous_args
    role_restricted
}
else := "denied by policy"

redactions := {} if { "admin" in input.roles }
else := {
    "secretKey": true,
    "password": true,
    "token": true,
    "apiKey": true,
    "secret": true,
    "privateKey": true,
}

max_args_size := 102400

tool_allowlists := {
    "fs-server":   {"readFile", "listDir", "writeFile"},
    "http-server": {"fetchUrl", "postUrl"},
}

missing_tool if { not input.tool }
missing_tool if { input.tool == "" }

tool_allowed if {
    allowed := tool_allowlists[input.upstreamId]
    input.tool in allowed
}

dangerous_patterns := [
    "../", "..\\\\", ";", "&&", "||", "\`", "$(", "\${",
    "%2e%2e", "%252e",
]

dangerous_args if {
    some key
    val := input.args[key]
    is_string(val)
    some pattern in dangerous_patterns
    contains(val, pattern)
}

write_tools := {"writeFile", "postUrl"}

role_restricted if {
    input.tool in write_tools
    "viewer" in input.roles
    not "admin" in input.roles
    not "editor" in input.roles
}`,
                updatedAt: '2026-02-24T15:45:00.000Z',
                updatedBy: 'security@oculisecurity.com',
                createdAt: '2026-01-10T09:00:00.000Z',
            },
            {
                name: 'Service Account Limited',
                description: 'Restricts service accounts to read-only operations only',
                version: '1.0.5',
                rego: `package gateway.service_account

import future.keywords.if
import future.keywords.in

default allow := false

read_tools := {"readFile", "listDir", "fetchUrl"}

allow if {
    "service" in input.roles
    input.tool in read_tools
    not dangerous_args
}

reason := "allowed" if { allow }
else := "service accounts restricted to read-only operations"

dangerous_patterns := ["../", "..\\\\", ";", "&&", "||", "\`", "$(", "\${"]

dangerous_args if {
    some key
    val := input.args[key]
    is_string(val)
    some pattern in dangerous_patterns
    contains(val, pattern)
}

redactions := {
    "secretKey": true,
    "password": true,
    "token": true,
    "apiKey": true,
}

max_args_size := 51200`,
                updatedAt: '2026-02-23T09:20:00.000Z',
                updatedBy: 'devops@oculisecurity.com',
                createdAt: '2026-01-20T14:00:00.000Z',
            },
        ];
        const insertMany = this.db.transaction(() => {
            for (const p of seedPolicies) {
                insert.run(p.name, p.description, p.version, p.rego, p.updatedAt, p.updatedBy, p.createdAt);
            }
        });
        insertMany();
    }
    list() {
        return this.db.prepare('SELECT * FROM policies ORDER BY updatedAt DESC').all();
    }
    getById(id) {
        return this.db.prepare('SELECT * FROM policies WHERE id = ?').get(id);
    }
    create(input) {
        const now = new Date().toISOString();
        const result = this.db.prepare(`
      INSERT INTO policies (name, description, version, rego, updatedAt, updatedBy, createdAt, isActive)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(input.name, input.description ?? '', input.version ?? '1.0.0', input.rego, now, input.updatedBy, now);
        return this.getById(Number(result.lastInsertRowid));
    }
    update(id, input) {
        const existing = this.getById(id);
        if (!existing)
            return undefined;
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE policies
      SET name = ?, description = ?, version = ?, rego = ?, updatedAt = ?, updatedBy = ?, isActive = ?
      WHERE id = ?
    `).run(input.name ?? existing.name, input.description ?? existing.description, input.version ?? existing.version, input.rego ?? existing.rego, now, input.updatedBy, input.isActive ?? existing.isActive, id);
        return this.getById(id);
    }
    duplicate(id) {
        const original = this.getById(id);
        if (!original)
            return undefined;
        return this.create({
            name: original.name + ' (Copy)',
            description: original.description,
            version: '1.0.0',
            rego: original.rego,
            updatedBy: original.updatedBy,
        });
    }
    delete(id) {
        const result = this.db.prepare('DELETE FROM policies WHERE id = ?').run(id);
        return result.changes > 0;
    }
    // ── Visual Rules ──────────────────────────────────────────────────────────
    seedVisualRules() {
        const count = this.db.prepare('SELECT COUNT(*) as cnt FROM visual_rules').get();
        if (count.cnt > 0)
            return;
        const now = new Date().toISOString();
        const insert = this.db.prepare(`
      INSERT INTO visual_rules (rule_id, tool, command_pattern, file_pattern, mcp_server, action, description, enabled, priority, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);
        const seeds = [
            { rule_id: 'no-rm-rf', tool: 'shell', command_pattern: 'rm\\s+-rf', file_pattern: null, mcp_server: null, action: 'deny', description: 'Block recursive force-delete commands', priority: 100 },
            { rule_id: 'no-path-traversal', tool: 'shell', command_pattern: '\\.\\./', file_pattern: null, mcp_server: null, action: 'deny', description: 'Block path traversal in shell commands', priority: 90 },
            { rule_id: 'warn-env-access', tool: 'file_read', command_pattern: null, file_pattern: '\\.env', mcp_server: null, action: 'warn', description: 'Warn when reading .env files', priority: 50 },
            { rule_id: 'warn-env-edit', tool: 'file_edit', command_pattern: null, file_pattern: '\\.env', mcp_server: null, action: 'warn', description: 'Warn when editing .env files', priority: 50 },
            { rule_id: 'warn-mcp', tool: 'mcp_call', command_pattern: null, file_pattern: null, mcp_server: null, action: 'warn', description: 'Warn on all MCP tool calls', priority: 10 },
        ];
        const insertMany = this.db.transaction(() => {
            for (const s of seeds) {
                insert.run(s.rule_id, s.tool, s.command_pattern, s.file_pattern, s.mcp_server, s.action, s.description, s.priority, now, now);
            }
        });
        insertMany();
    }
    listVisualRules() {
        return this.db.prepare('SELECT * FROM visual_rules ORDER BY priority DESC, id ASC').all();
    }
    getVisualRuleById(id) {
        return this.db.prepare('SELECT * FROM visual_rules WHERE id = ?').get(id);
    }
    createVisualRule(input) {
        const now = new Date().toISOString();
        const result = this.db.prepare(`
      INSERT INTO visual_rules (rule_id, tool, command_pattern, file_pattern, mcp_server, action, description, enabled, priority, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(input.rule_id, input.tool ?? null, input.command_pattern ?? null, input.file_pattern ?? null, input.mcp_server ?? null, input.action, input.description ?? '', input.enabled ?? 1, input.priority ?? 0, now, now);
        return this.getVisualRuleById(Number(result.lastInsertRowid));
    }
    updateVisualRule(id, input) {
        const existing = this.getVisualRuleById(id);
        if (!existing)
            return undefined;
        const now = new Date().toISOString();
        this.db.prepare(`
      UPDATE visual_rules
      SET rule_id = ?, tool = ?, command_pattern = ?, file_pattern = ?, mcp_server = ?,
          action = ?, description = ?, enabled = ?, priority = ?, updatedAt = ?
      WHERE id = ?
    `).run(input.rule_id ?? existing.rule_id, input.tool !== undefined ? input.tool : existing.tool, input.command_pattern !== undefined ? input.command_pattern : existing.command_pattern, input.file_pattern !== undefined ? input.file_pattern : existing.file_pattern, input.mcp_server !== undefined ? input.mcp_server : existing.mcp_server, input.action ?? existing.action, input.description ?? existing.description, input.enabled !== undefined ? input.enabled : existing.enabled, input.priority !== undefined ? input.priority : existing.priority, now, id);
        return this.getVisualRuleById(id);
    }
    deleteVisualRule(id) {
        const result = this.db.prepare('DELETE FROM visual_rules WHERE id = ?').run(id);
        return result.changes > 0;
    }
    close() {
        this.db.close();
    }
}
exports.PolicyStore = PolicyStore;
