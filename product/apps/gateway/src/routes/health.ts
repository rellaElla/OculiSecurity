import { FastifyInstance } from 'fastify';

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/health', async (_req, reply) => {
    reply.send({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'oculi-security-gateway',
    });
  });
}
