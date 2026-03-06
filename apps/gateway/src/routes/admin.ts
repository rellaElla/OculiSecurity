import { FastifyInstance, FastifyRequest } from 'fastify';
import { AppConfig } from '../config';
import { AuditService } from '../services/audit';
import { UpstreamConnector } from '../services/upstream';
import { PolicyStore } from '../services/policy-store';
import { PolicyService } from '../services/policy';

interface AdminRouteContext {
  audit: AuditService;
  upstream: UpstreamConnector;
  config: AppConfig;
  policyStore: PolicyStore;
  policy: PolicyService;
}

export function registerAdminRoutes(
  app: FastifyInstance,
  ctx: AdminRouteContext
): void {
  // GET /admin/search — unified search over audit records (unauthenticated — demo only)
  app.get<{ Querystring: { q?: string; decision?: string; limit?: string; offset?: string; from?: string; to?: string } }>(
    '/admin/search',
    async (request, reply) => {
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
    }
  );

  // GET /admin/aggregate — server-side GROUP BY aggregation (unauthenticated — demo only)
  app.get<{ Querystring: { groupBy?: string; q?: string; decision?: string; from?: string; to?: string; limit?: string } }>(
    '/admin/aggregate',
    async (request, reply) => {
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
    }
  );

  // GET /admin/logs — recent audit log entries (requires auth)
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/admin/logs',
    async (
      request: FastifyRequest<{ Querystring: { limit?: string; offset?: string } }>,
      reply
    ) => {
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
    }
  );

  // GET /admin/upstreams — list registered upstreams (requires auth)
  app.get('/admin/upstreams', async (request, reply) => {
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

  app.get<{ Querystring: { hours?: string } }>(
    '/admin/stats/summary',
    async (request, reply) => {
      const hours = Math.min(parseInt(request.query.hours ?? '24', 10) || 24, 720);
      reply.send(ctx.audit.summary(hours));
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/admin/stats/top-tools',
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? '5', 10) || 5, 50);
      reply.send(ctx.audit.topTools(limit));
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/admin/stats/top-denied',
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? '5', 10) || 5, 50);
      reply.send(ctx.audit.topDeniedTools(limit));
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/admin/stats/top-actors',
    async (request, reply) => {
      const limit = Math.min(parseInt(request.query.limit ?? '5', 10) || 5, 50);
      reply.send(ctx.audit.topActors(limit));
    }
  );

  app.get('/admin/stats/decisions', async (_request, reply) => {
    reply.send(ctx.audit.decisionBreakdown());
  });

  app.get<{ Querystring: { hours?: string; bucket?: string } }>(
    '/admin/stats/timeseries',
    async (request, reply) => {
      const hours = Math.min(parseInt(request.query.hours ?? '1', 10) || 1, 168);
      const bucket = Math.min(parseInt(request.query.bucket ?? '5', 10) || 5, 60);
      reply.send(ctx.audit.timeSeries(hours, bucket));
    }
  );

  // -----------------------------------------------------------------------
  // Settings (read-only view of runtime config)
  // -----------------------------------------------------------------------

  app.get('/admin/settings', async (_request, reply) => {
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
  app.post<{ Body: { input: Record<string, unknown> } }>(
    '/admin/policies/test',
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      if (!body.input || typeof body.input !== 'object') {
        reply.code(400).send({ error: 'input object is required' });
        return;
      }
      try {
        const decision = await ctx.policy.evaluate(body.input as any);
        reply.send({ decision });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reply.code(500).send({ error: 'Policy evaluation failed', details: msg });
      }
    }
  );

  // GET /admin/policies — list all policies
  app.get('/admin/policies', async (_request, reply) => {
    const policies = ctx.policyStore.list();
    reply.send({ policies });
  });

  // GET /admin/policies/:id — get single policy
  app.get<{ Params: { id: string } }>(
    '/admin/policies/:id',
    async (request, reply) => {
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
    }
  );

  // POST /admin/policies — create new policy
  app.post<{ Body: { name: string; rego: string; description?: string; version?: string; updatedBy?: string } }>(
    '/admin/policies',
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const name = body.name as string | undefined;
      const rego = body.rego as string | undefined;
      if (!name || !rego) {
        reply.code(400).send({ error: 'name and rego are required' });
        return;
      }
      const created = ctx.policyStore.create({
        name,
        rego,
        description: (body.description as string) ?? undefined,
        version: (body.version as string) ?? undefined,
        updatedBy: (body.updatedBy as string) ?? 'admin@oculi.security',
      });
      reply.code(201).send(created);
    }
  );

  // PUT /admin/policies/:id — update policy
  app.put<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/admin/policies/:id',
    async (request, reply) => {
      const id = parseInt(request.params.id, 10);
      if (isNaN(id)) {
        reply.code(400).send({ error: 'Invalid policy id' });
        return;
      }
      const body = request.body as Record<string, unknown>;
      const updated = ctx.policyStore.update(id, {
        name: body.name as string | undefined,
        description: body.description as string | undefined,
        version: body.version as string | undefined,
        rego: body.rego as string | undefined,
        updatedBy: (body.updatedBy as string) ?? 'admin@oculi.security',
        isActive: body.isActive as number | undefined,
      });
      if (!updated) {
        reply.code(404).send({ error: 'Policy not found' });
        return;
      }
      reply.send(updated);
    }
  );

  // POST /admin/policies/:id/duplicate — duplicate a policy
  app.post<{ Params: { id: string } }>(
    '/admin/policies/:id/duplicate',
    async (request, reply) => {
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
    }
  );

  // DELETE /admin/policies/:id — delete a policy
  app.delete<{ Params: { id: string } }>(
    '/admin/policies/:id',
    async (request, reply) => {
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
    }
  );
}
