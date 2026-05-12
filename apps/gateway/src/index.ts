import { loadConfig, ConfigValidationError } from './config';
import { buildServer } from './server';

async function main() {
  const config = loadConfig();
  const { app, close } = await buildServer(config);

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[gateway] Oculi Security Gateway listening on :${config.port}`);
    console.log(`[gateway] OPA: ${config.opaEnabled ? config.opaUrl : 'disabled (built-in policy)'}`);
    console.log(`[gateway] Upstreams: ${config.upstreams.map((u) => u.id).join(', ')}`);
    console.log(`[gateway] Admin UI: http://localhost:${config.port}/admin`);
  } catch (err) {
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
  if (err instanceof ConfigValidationError) {
    console.error(err.message);
    process.exit(1);
  }
  console.error('[gateway] Fatal error:', err);
  process.exit(1);
});
