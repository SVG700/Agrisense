/**
 * Agrisense AI - API entry point: validate config, wire dependencies, listen.
 */
import { loadConfig } from './config.js';
import { createLogger } from './utils/logger.js';
import { createStore } from './db/index.js';
import { createVision } from './services/vision.js';
import { createAdvisor } from './services/advisor.js';
import { createApp } from './app.js';

const logger = createLogger();
const { config, errors, warnings } = loadConfig();

if (errors.length) {
  for (const e of errors) logger.error('config_invalid', { problem: e });
  logger.error('startup_aborted', { reason: 'invalid configuration - see backend/.env.example' });
  process.exit(1);
}
for (const w of warnings) logger.warn('config_notice', { notice: w });

const store = await createStore({ config, logger });
const vision = createVision({ config, logger });
const advisor = createAdvisor({ config, logger });
const app = createApp({ config, store, vision, advisor, logger });

const server = app.listen(config.port, () => {
  logger.info('server_started', {
    url: config.publicBaseUrl,
    mode: config.demoMode ? 'demo' : 'standard',
    store: store.kind,
    vision: vision.describe(),
    advisor: advisor.describe(),
    device_auth: config.auth.deviceKeys.length ? 'required' : 'disabled',
    admin_auth: config.auth.adminKey ? 'required' : 'disabled',
  });
});
server.requestTimeout = config.requestTimeoutMs;
server.headersTimeout = Math.min(60_000, config.requestTimeoutMs);

let closing = false;
const shutdown = (signal) => {
  if (closing) return;
  closing = true;
  logger.info('shutdown', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('unhandled_rejection', { error: String(reason) }));
