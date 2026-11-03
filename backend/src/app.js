/**
 * Express app factory. All dependencies are injected so tests can run the
 * real HTTP stack against mock stores and providers.
 */
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { LOW_BATTERY_THRESHOLD, SENSOR_LIMITS, integrationFlags } from './config.js';
import { telemetryRouter } from './routes/telemetry.js';
import { devicesRouter, deviceAdminRouter } from './routes/devices.js';
import { mapRouter } from './routes/map.js';
import { demoRouter } from './routes/demo.js';
import { checkRouter } from './routes/check.js';
import { renderTrapSvg } from './services/mockTrap.js';
import { errorHandler, notFound } from './middleware/errors.js';

const REQUEST_ID_RE = /^[\w-]{8,64}$/;

/**
 * @param {{config, store, vision, advisor, logger}} deps
 */
export function createApp(deps) {
  const { config, store, vision, advisor, logger } = deps;
  const app = express();
  const startedAt = Date.now();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  // Request id + basic security headers
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id');
    req.id = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    res.set({
      'X-Request-Id': req.id,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      // The API serves JSON and self-contained SVGs only: nothing may load or frame it
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    });
    next();
  });

  app.use(
    cors({
      origin: (origin, cb) =>
        // Non-browser clients (Pi, simulator, curl) send no Origin header
        !origin || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)
          ? cb(null, true)
          : cb(new Error(`Origin ${origin} not allowed by CORS`)),
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Key', 'X-Admin-Key', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
    })
  );

  // base64 inflates images by ~4/3; leave headroom for the JSON envelope
  app.use(express.json({ limit: Math.ceil(config.maxImageBytes * 1.4) + 64 * 1024 }));

  // Access log (no headers or bodies -> no secrets)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path === '/api/health' || req.path.startsWith('/api/mock-trap')) return;
      logger.info('http', { request_id: req.id, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start });
    });
    next();
  });

  // Liveness + configuration summary (booleans/states only, never secrets)
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      mode: config.demoMode ? 'demo' : 'standard',
      store: store.kind,
      integrations: integrationFlags(config),
      services: { vision: vision.describe(), advisor: advisor.describe() },
      auth: {
        device: config.auth.deviceKeys.length ? 'required' : 'disabled',
        admin: config.auth.adminKey ? 'required' : 'disabled',
      },
      low_battery_threshold: LOW_BATTERY_THRESHOLD,
      sensor_limits: SENSOR_LIMITS,
      uptime_s: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  // Readiness: can we actually reach the database?
  app.get('/api/ready', async (req, res) => {
    try {
      await store.ping();
      res.json({ ready: true, store: store.kind });
    } catch (err) {
      logger.warn('readiness_failed', { error: err.message, cause: err.cause?.message, request_id: req.id });
      res.status(503).json({ ready: false, store: store.kind, error: 'Database unreachable', code: 'database_unavailable' });
    }
  });

  // Synthetic sticky-trap images (demo / simulator)
  app.get('/api/mock-trap/:seed.svg', (req, res) => {
    const seed = String(req.params.seed).slice(0, 64);
    const density = Number(req.query.d ?? 0.4);
    const opts = { mix: String(req.query.m ?? 'default'), predators: Number(req.query.p ?? 0) };
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(renderTrapSvg(seed, density, opts));
  });

  app.use('/api/telemetry', telemetryRouter(deps));
  app.use('/api/devices', devicesRouter(deps));
  app.use('/api/device', deviceAdminRouter(deps));
  app.use('/api', mapRouter(deps));
  app.use('/api', demoRouter(deps));
  app.use('/api', checkRouter(deps));

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
