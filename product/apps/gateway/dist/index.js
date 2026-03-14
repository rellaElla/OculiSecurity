"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const server_1 = require("./server");
async function main() {
    const config = (0, config_1.loadConfig)();
    const { app, close } = await (0, server_1.buildServer)(config);
    try {
        await app.listen({ port: config.port, host: '0.0.0.0' });
        console.log(`[gateway] Oculi Security Gateway listening on :${config.port}`);
        console.log(`[gateway] OPA: ${config.opaEnabled ? config.opaUrl : 'disabled (built-in policy)'}`);
        console.log(`[gateway] Upstreams: ${config.upstreams.map((u) => u.id).join(', ')}`);
        console.log(`[gateway] Admin UI: http://localhost:${config.port}/admin`);
    }
    catch (err) {
        app.log.error(err);
        process.exit(1);
    }
    // Graceful shutdown
    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.on(signal, async () => {
            console.log(`\n[gateway] Received ${signal}, shutting down...`);
            await close();
            process.exit(0);
        });
    }
}
main().catch((err) => {
    console.error('[gateway] Fatal error:', err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map