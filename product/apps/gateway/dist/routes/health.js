"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerHealthRoutes = registerHealthRoutes;
function registerHealthRoutes(app) {
    app.get('/health', async (_req, reply) => {
        reply.send({
            status: 'ok',
            timestamp: new Date().toISOString(),
            service: 'oculi-security-gateway',
        });
    });
}
//# sourceMappingURL=health.js.map