import { createApp } from './app.js';
import { closeAzureConnections } from './azure.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = createApp(config, { enableQlikScheduler: true, enableUsageMaintenance: true });
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'server.started', port: config.port }));
});

async function shutdown(signal: string) {
  console.log(JSON.stringify({ event: 'server.stopping', signal }));
  const stop = app.locals.stopQlikScheduler as (() => void) | undefined;
  stop?.();
  (app.locals.stopUsageMaintenance as (() => void) | undefined)?.();
  (app.locals.closeQlikSessions as (() => void) | undefined)?.();
  server.close(async () => {
    await closeAzureConnections();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
