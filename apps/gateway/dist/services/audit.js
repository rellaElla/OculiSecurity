"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const sqlite_loader_1 = require("./sqlite-loader");
class AuditService {
    db;
    storeFullArgs;
    constructor(config) {
        this.storeFullArgs = config.storeFullArgs;
        // Ensure data directory exists
        const dir = path_1.default.dirname(config.dbPath);
        if (!fs_1.default.existsSync(dir)) {
            fs_1.default.mkdirSync(dir, { recursive: true });
        }
        const Ctor = (0, sqlite_loader_1.loadSqlite)();
        this.db = new Ctor(config.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        this.initialize();
    }
    initialize() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        requestId     TEXT NOT NULL,
        timestamp     TEXT NOT NULL,
        actor         TEXT NOT NULL,
        orgId         TEXT NOT NULL,
        upstreamId    TEXT NOT NULL,
        tool          TEXT NOT NULL,
        argsHash      TEXT NOT NULL,
        argsJson      TEXT,
        decision      TEXT NOT NULL CHECK(decision IN ('allow', 'deny')),
        reason        TEXT NOT NULL,
        latencyMs     INTEGER NOT NULL,
        outcome       TEXT NOT NULL CHECK(outcome IN ('success', 'error', 'denied')),
        responseHash  TEXT,
        ip            TEXT NOT NULL,
        sessionId     TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_audit_actor     ON audit_logs(actor);
      CREATE INDEX IF NOT EXISTS idx_audit_tool      ON audit_logs(tool);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_decision  ON audit_logs(decision);
      CREATE INDEX IF NOT EXISTS idx_audit_requestId ON audit_logs(requestId);
    `);
        // Migration: add responseJson column to existing databases (SQLite ignores duplicate ADD COLUMN errors)
        try {
            this.db.exec('ALTER TABLE audit_logs ADD COLUMN responseJson TEXT');
        }
        catch {
            // Column already exists — no-op
        }
    }
    /** SHA-256 hex prefix of JSON-serialised data */
    hash(data) {
        return crypto_1.default
            .createHash('sha256')
            .update(JSON.stringify(data))
            .digest('hex')
            .slice(0, 16);
    }
    log(record) {
        const stmt = this.db.prepare(`
      INSERT INTO audit_logs (
        requestId, timestamp, actor, orgId, upstreamId, tool,
        argsHash, argsJson, decision, reason, latencyMs,
        outcome, responseHash, responseJson, ip, sessionId
      ) VALUES (
        @requestId, @timestamp, @actor, @orgId, @upstreamId, @tool,
        @argsHash, @argsJson, @decision, @reason, @latencyMs,
        @outcome, @responseHash, @responseJson, @ip, @sessionId
      )
    `);
        stmt.run({
            ...record,
            argsJson: record.argsJson ?? null,
            responseHash: record.responseHash ?? null,
            responseJson: record.responseJson ?? null,
        });
    }
    /** Read recent audit records (descending by timestamp) */
    query(limit = 100, offset = 0) {
        return this.db
            .prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?')
            .all(limit, offset);
    }
    /** Count total rows */
    count() {
        const row = this.db
            .prepare('SELECT COUNT(*) as n FROM audit_logs')
            .get();
        return row.n;
    }
    /** Summary stats for the last N hours */
    summary(hours = 24) {
        const since = new Date(Date.now() - hours * 3600_000).toISOString();
        const row = this.db
            .prepare(`SELECT
          COUNT(*)                                            AS totalCalls,
          SUM(CASE WHEN decision = 'deny' THEN 1 ELSE 0 END) AS deniedCalls,
          COALESCE(AVG(latencyMs), 0)                         AS avgLatencyMs,
          SUM(CASE WHEN reason = 'rate limit exceeded' THEN 1 ELSE 0 END) AS rateLimitViolations
        FROM audit_logs
        WHERE timestamp >= ?`)
            .get(since);
        return {
            totalCalls: row.totalCalls,
            deniedCalls: row.deniedCalls,
            avgLatencyMs: Math.round(row.avgLatencyMs),
            rateLimitViolations: row.rateLimitViolations,
        };
    }
    /** Top N tools by total call count */
    topTools(limit = 5) {
        return this.db
            .prepare(`SELECT tool, COUNT(*) AS count
        FROM audit_logs
        GROUP BY tool
        ORDER BY count DESC
        LIMIT ?`)
            .all(limit);
    }
    /** Top N denied tools */
    topDeniedTools(limit = 5) {
        return this.db
            .prepare(`SELECT tool, COUNT(*) AS count
        FROM audit_logs
        WHERE decision = 'deny'
        GROUP BY tool
        ORDER BY count DESC
        LIMIT ?`)
            .all(limit);
    }
    /** Top N actors by activity */
    topActors(limit = 5) {
        return this.db
            .prepare(`SELECT actor, COUNT(*) AS count
        FROM audit_logs
        GROUP BY actor
        ORDER BY count DESC
        LIMIT ?`)
            .all(limit);
    }
    /** Allowed vs denied breakdown */
    decisionBreakdown() {
        const row = this.db
            .prepare(`SELECT
          SUM(CASE WHEN decision = 'allow' THEN 1 ELSE 0 END) AS allowed,
          SUM(CASE WHEN decision = 'deny'  THEN 1 ELSE 0 END) AS denied
        FROM audit_logs`)
            .get();
        return { allowed: row.allowed ?? 0, denied: row.denied ?? 0 };
    }
    /** Time-series: calls grouped into fixed-width buckets */
    timeSeries(hours = 1, bucketMinutes = 5) {
        const since = new Date(Date.now() - hours * 3600_000).toISOString();
        const bucketSeconds = bucketMinutes * 60;
        return this.db
            .prepare(`SELECT
          strftime('%Y-%m-%dT%H:%M:00Z',
            (CAST(strftime('%s', timestamp) AS INTEGER) / ${bucketSeconds}) * ${bucketSeconds},
            'unixepoch'
          ) AS bucket,
          COUNT(*) AS count
        FROM audit_logs
        WHERE timestamp >= ?
        GROUP BY bucket
        ORDER BY bucket ASC`)
            .all(since);
    }
    /** Search audit records with optional filters */
    search(opts) {
        const limit = Math.min(opts.limit ?? 100, 500);
        const offset = opts.offset ?? 0;
        const q = opts.q?.trim() || null;
        const decision = opts.decision === 'allow' || opts.decision === 'deny' ? opts.decision : null;
        const conditions = [];
        const params = [];
        if (q) {
            conditions.push('(actor LIKE ? OR tool LIKE ? OR upstreamId LIKE ?)');
            const like = '%' + q + '%';
            params.push(like, like, like);
        }
        if (decision) {
            conditions.push('decision = ?');
            params.push(decision);
        }
        if (opts.from) {
            conditions.push('timestamp >= ?');
            params.push(opts.from);
        }
        if (opts.to) {
            conditions.push('timestamp <= ?');
            params.push(opts.to);
        }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const total = this.db
            .prepare('SELECT COUNT(*) AS n FROM audit_logs ' + where)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .get(...params).n;
        const records = this.db
            .prepare('SELECT * FROM audit_logs ' + where + ' ORDER BY timestamp DESC LIMIT ? OFFSET ?')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .all(...params, limit, offset);
        return { total, results: records };
    }
    static ALLOWED_GROUP_BY_FIELDS = {
        actor: 'actor',
        tool: 'tool',
        upstream: 'upstreamId',
        upstreamId: 'upstreamId',
        decision: 'decision',
        outcome: 'outcome',
        orgId: 'orgId',
    };
    /** Group-by aggregation with optional WHERE filters */
    aggregate(opts) {
        const limit = Math.min(opts.limit ?? 100, 500);
        const q = opts.q?.trim() || null;
        const decision = opts.decision === 'allow' || opts.decision === 'deny' ? opts.decision : null;
        // Map user-provided field names to SQL column names (injection prevention)
        const allowlist = AuditService.ALLOWED_GROUP_BY_FIELDS;
        const resolvedCols = opts.groupBy
            .map((f) => allowlist[f] ?? null)
            .filter((c) => c !== null);
        if (resolvedCols.length === 0) {
            return { groupBy: opts.groupBy, results: [] };
        }
        const conditions = [];
        const params = [];
        if (q) {
            conditions.push('(actor LIKE ? OR tool LIKE ? OR upstreamId LIKE ?)');
            const like = '%' + q + '%';
            params.push(like, like, like);
        }
        if (decision) {
            conditions.push('decision = ?');
            params.push(decision);
        }
        if (opts.from) {
            conditions.push('timestamp >= ?');
            params.push(opts.from);
        }
        if (opts.to) {
            conditions.push('timestamp <= ?');
            params.push(opts.to);
        }
        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
        const colList = resolvedCols.join(', ');
        const sql = `SELECT ${colList}, COUNT(*) AS count FROM audit_logs ${where} GROUP BY ${colList} ORDER BY count DESC LIMIT ?`;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = this.db.prepare(sql).all(...params, limit);
        return { groupBy: opts.groupBy, results: rows };
    }
    close() {
        this.db.close();
    }
}
exports.AuditService = AuditService;
