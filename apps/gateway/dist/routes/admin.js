"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAdminRoutes = registerAdminRoutes;
const local_policy_1 = require("../services/local-policy");
function registerAdminRoutes(app, ctx) {
    // GET /admin/search — unified search over audit records (unauthenticated — demo only)
    app.get('/api/admin/search', async (request, reply) => {
        const limit = Math.min(parseInt(request.query.limit ?? '50', 10) || 50, 500);
        const offset = parseInt(request.query.offset ?? '0', 10) || 0;
        const result = ctx.audit.search({
            q: request.query.q,
            decision: request.query.decision,
            from: request.query.from,
            to: request.query.to,
            limit,
            offset,
        });
        reply.send(result);
    });
    // GET /admin/aggregate — server-side GROUP BY aggregation (unauthenticated — demo only)
    app.get('/api/admin/aggregate', async (request, reply) => {
        const groupByRaw = request.query.groupBy;
        if (!groupByRaw || !groupByRaw.trim()) {
            reply.code(400).send({ error: 'groupBy is required' });
            return;
        }
        const groupBy = groupByRaw.split(',').map((s) => s.trim()).filter(Boolean);
        if (groupBy.length === 0) {
            reply.code(400).send({ error: 'groupBy is required' });
            return;
        }
        const limit = Math.min(parseInt(request.query.limit ?? '100', 10) || 100, 500);
        const result = ctx.audit.aggregate({
            groupBy,
            q: request.query.q,
            decision: request.query.decision,
            from: request.query.from,
            to: request.query.to,
            limit,
        });
        reply.send(result);
    });
    // GET /admin/logs — recent audit log entries (requires auth)
    app.get('/api/admin/logs', async (request, reply) => {
        // Auth check — require at least some valid actor (set by auth middleware)
        if (!request.actor?.actor) {
            reply.code(401).send({ error: 'Unauthorized' });
            return;
        }
        const limit = Math.min(parseInt(request.query.limit ?? '50', 10), 500);
        const offset = parseInt(request.query.offset ?? '0', 10);
        const logs = ctx.audit.query(limit, offset);
        const total = ctx.audit.count();
        reply.send({ total, limit, offset, logs });
    });
    // GET /admin/upstreams — list registered upstreams (requires auth)
    app.get('/api/admin/upstreams', async (request, reply) => {
        if (!request.actor?.actor) {
            reply.code(401).send({ error: 'Unauthorized' });
            return;
        }
        const upstreams = ctx.upstream.listUpstreams().map((u) => ({
            id: u.id,
            name: u.name,
            baseUrl: u.baseUrl,
            timeout: u.timeout,
            // never expose authHeader
        }));
        reply.send({ upstreams });
    });
    // -----------------------------------------------------------------------
    // Dashboard stats endpoints (unauthenticated — demo only)
    // -----------------------------------------------------------------------
    app.get('/api/admin/stats/summary', async (request, reply) => {
        const hours = Math.min(parseInt(request.query.hours ?? '24', 10) || 24, 720);
        reply.send(ctx.audit.summary(hours));
    });
    app.get('/api/admin/stats/top-tools', async (request, reply) => {
        const limit = Math.min(parseInt(request.query.limit ?? '5', 10) || 5, 50);
        reply.send(ctx.audit.topTools(limit));
    });
    app.get('/api/admin/stats/top-denied', async (request, reply) => {
        const limit = Math.min(parseInt(request.query.limit ?? '5', 10) || 5, 50);
        reply.send(ctx.audit.topDeniedTools(limit));
    });
    app.get('/api/admin/stats/top-actors', async (request, reply) => {
        const limit = Math.min(parseInt(request.query.limit ?? '5', 10) || 5, 50);
        reply.send(ctx.audit.topActors(limit));
    });
    app.get('/api/admin/stats/decisions', async (_request, reply) => {
        reply.send(ctx.audit.decisionBreakdown());
    });
    app.get('/api/admin/stats/timeseries', async (request, reply) => {
        const hours = Math.min(parseInt(request.query.hours ?? '1', 10) || 1, 168);
        const bucket = Math.min(parseInt(request.query.bucket ?? '5', 10) || 5, 60);
        reply.send(ctx.audit.timeSeries(hours, bucket));
    });
    // -----------------------------------------------------------------------
    // Settings (read-only view of runtime config)
    // -----------------------------------------------------------------------
    app.get('/api/admin/settings', async (_request, reply) => {
        const c = ctx.config;
        reply.send({
            gateway: {
                port: c.port,
                logLevel: c.logLevel,
                opaEnabled: c.opaEnabled,
                opaUrl: c.opaEnabled ? c.opaUrl : null,
                storeFullArgs: c.storeFullArgs,
                dbPath: c.dbPath,
            },
            rateLimit: {
                capacity: c.rateLimitCapacity,
                refillPerSecond: c.rateLimitRefillPerSecond,
            },
            upstreams: c.upstreams.map((u) => ({
                id: u.id,
                name: u.name,
                baseUrl: u.baseUrl,
                timeout: u.timeout,
                hasAuth: !!u.authHeader,
                tools: u.tools ?? [],
            })),
            telemetry: {
                endpointUrl: '/v1/events',
                claudeCodeHook: {
                    type: 'http',
                    url: `http://<gateway-host>:${c.port}/v1/events`,
                },
            },
        });
    });
    // -----------------------------------------------------------------------
    // Policy management (unauthenticated — demo only)
    // -----------------------------------------------------------------------
    // POST /admin/policies/test — must be registered BEFORE :id param route
    app.post('/api/admin/policies/test', async (request, reply) => {
        const body = request.body;
        if (!body.input || typeof body.input !== 'object') {
            reply.code(400).send({ error: 'input object is required' });
            return;
        }
        try {
            const decision = await ctx.policy.evaluate(body.input);
            reply.send({ decision });
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            reply.code(500).send({ error: 'Policy evaluation failed', details: msg });
        }
    });
    // GET /admin/policies — list all policies
    app.get('/api/admin/policies', async (_request, reply) => {
        const policies = ctx.policyStore.list();
        reply.send({ policies });
    });
    // GET /admin/policies/:id — get single policy
    app.get('/api/admin/policies/:id', async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) {
            reply.code(400).send({ error: 'Invalid policy id' });
            return;
        }
        const policy = ctx.policyStore.getById(id);
        if (!policy) {
            reply.code(404).send({ error: 'Policy not found' });
            return;
        }
        reply.send(policy);
    });
    // POST /admin/policies — create new policy
    app.post('/api/admin/policies', async (request, reply) => {
        const body = request.body;
        const name = body.name;
        const rego = body.rego;
        if (!name || !rego) {
            reply.code(400).send({ error: 'name and rego are required' });
            return;
        }
        const created = ctx.policyStore.create({
            name,
            rego,
            description: body.description ?? undefined,
            version: body.version ?? undefined,
            updatedBy: body.updatedBy ?? 'admin@oculisecurity.com',
        });
        reply.code(201).send(created);
    });
    // PUT /admin/policies/:id — update policy
    app.put('/api/admin/policies/:id', async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) {
            reply.code(400).send({ error: 'Invalid policy id' });
            return;
        }
        const body = request.body;
        const updated = ctx.policyStore.update(id, {
            name: body.name,
            description: body.description,
            version: body.version,
            rego: body.rego,
            updatedBy: body.updatedBy ?? 'admin@oculisecurity.com',
            isActive: body.isActive,
        });
        if (!updated) {
            reply.code(404).send({ error: 'Policy not found' });
            return;
        }
        reply.send(updated);
    });
    // POST /admin/policies/:id/duplicate — duplicate a policy
    app.post('/api/admin/policies/:id/duplicate', async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) {
            reply.code(400).send({ error: 'Invalid policy id' });
            return;
        }
        const duplicated = ctx.policyStore.duplicate(id);
        if (!duplicated) {
            reply.code(404).send({ error: 'Policy not found' });
            return;
        }
        reply.code(201).send(duplicated);
    });
    // DELETE /admin/policies/:id — delete a policy
    app.delete('/api/admin/policies/:id', async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) {
            reply.code(400).send({ error: 'Invalid policy id' });
            return;
        }
        const deleted = ctx.policyStore.delete(id);
        if (!deleted) {
            reply.code(404).send({ error: 'Policy not found' });
            return;
        }
        reply.send({ success: true });
    });
    // -----------------------------------------------------------------------
    // Visual Rules (unauthenticated — demo only)
    // -----------------------------------------------------------------------
    // POST /admin/rules/test — must be registered BEFORE :id param route
    app.post('/api/admin/rules/test', async (request, reply) => {
        const body = request.body;
        const ruleInput = body.rule;
        const eventInput = body.event;
        if (!ruleInput || !eventInput) {
            reply.code(400).send({ error: 'rule and event objects are required' });
            return;
        }
        // Validate regex patterns
        for (const field of ['command_pattern', 'file_pattern']) {
            const pattern = ruleInput[field];
            if (pattern) {
                try {
                    new RegExp(pattern);
                }
                catch {
                    reply.code(400).send({ error: `Invalid regex in ${field}: ${pattern}` });
                    return;
                }
            }
        }
        const policyRule = {
            id: ruleInput.rule_id ?? 'test',
            match: {
                tool: ruleInput.tool,
                command_pattern: ruleInput.command_pattern,
                file_pattern: ruleInput.file_pattern,
                mcp_server: ruleInput.mcp_server,
            },
            action: (['deny', 'warn', 'allow'].includes(ruleInput.action)
                ? ruleInput.action
                : 'deny'),
        };
        const event = eventInput;
        const matches = (0, local_policy_1.ruleMatches)(policyRule, event);
        reply.send({ matches, action: matches ? policyRule.action : 'no match' });
    });
    // GET /admin/rules — list all visual rules
    app.get('/api/admin/rules', async (_request, reply) => {
        const rules = ctx.policyStore.listVisualRules();
        reply.send({ rules });
    });
    // GET /admin/rules/:id — get single visual rule
    app.get('/api/admin/rules/:id', async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) {
            reply.code(400).send({ error: 'Invalid rule id' });
            return;
        }
        const rule = ctx.policyStore.getVisualRuleById(id);
        if (!rule) {
            reply.code(404).send({ error: 'Rule not found' });
            return;
        }
        reply.send(rule);
    });
    // POST /admin/rules — create visual rule
    app.post('/api/admin/rules', async (request, reply) => {
        const body = request.body;
        const rule_id = body.rule_id;
        const action = body.action;
        if (!rule_id || !action) {
            reply.code(400).send({ error: 'rule_id and action are required' });
            return;
        }
        if (!['deny', 'warn', 'allow'].includes(action)) {
            reply.code(400).send({ error: 'action must be deny, warn, or allow' });
            return;
        }
        // Validate regex patterns
        for (const field of ['command_pattern', 'file_pattern']) {
            const pattern = body[field];
            if (pattern) {
                try {
                    new RegExp(pattern);
                }
                catch {
                    reply.code(400).send({ error: `Invalid regex in ${field}: ${pattern}` });
                    return;
                }
            }
        }
        // Check at least one match field
        if (!body.tool && !body.command_pattern && !body.file_pattern && !body.mcp_server) {
            reply.code(400).send({ error: 'At least one match field (tool, command_pattern, file_pattern, mcp_server) is required' });
            return;
        }
        try {
            const created = ctx.policyStore.createVisualRule(body);
            reply.code(201).send(created);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('UNIQUE constraint')) {
                reply.code(409).send({ error: `Rule ID "${rule_id}" already exists` });
                return;
            }
            throw err;
        }
    });
    // PUT /admin/rules/:id — update visual rule
    app.put('/api/admin/rules/:id', async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) {
            reply.code(400).send({ error: 'Invalid rule id' });
            return;
        }
        const body = request.body;
        // Validate regex patterns if provided
        for (const field of ['command_pattern', 'file_pattern']) {
            const pattern = body[field];
            if (pattern) {
                try {
                    new RegExp(pattern);
                }
                catch {
                    reply.code(400).send({ error: `Invalid regex in ${field}: ${pattern}` });
                    return;
                }
            }
        }
        if (body.action && !['deny', 'warn', 'allow'].includes(body.action)) {
            reply.code(400).send({ error: 'action must be deny, warn, or allow' });
            return;
        }
        try {
            const updated = ctx.policyStore.updateVisualRule(id, body);
            if (!updated) {
                reply.code(404).send({ error: 'Rule not found' });
                return;
            }
            reply.send(updated);
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('UNIQUE constraint')) {
                reply.code(409).send({ error: `Rule ID "${body.rule_id}" already exists` });
                return;
            }
            throw err;
        }
    });
    // DELETE /admin/rules/:id — delete visual rule
    app.delete('/api/admin/rules/:id', async (request, reply) => {
        const id = parseInt(request.params.id, 10);
        if (isNaN(id)) {
            reply.code(400).send({ error: 'Invalid rule id' });
            return;
        }
        const deleted = ctx.policyStore.deleteVisualRule(id);
        if (!deleted) {
            reply.code(404).send({ error: 'Rule not found' });
            return;
        }
        reply.send({ success: true });
    });
}
