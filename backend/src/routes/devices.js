/**
 * Device routes
 *   GET   /api/devices          list trap stations (read-only, public)
 *   POST  /api/devices          register a station {name}           (admin)
 *   PATCH /api/device/battery   manual override {device_id, battery_level} (admin)
 *
 * Manual overrides are recorded with battery_source='manual' and a timestamp
 * so the UI never presents them as a physical sensor reading.
 */
import { Router } from 'express';
import { LOW_BATTERY_THRESHOLD } from '../config.js';
import { requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError, batteryLevel, requireUuid, statusForBattery } from '../utils/validate.js';

export function devicesRouter({ config, store }) {
  const router = Router();
  const adminLimit = rateLimit({ name: 'admin', windowMs: config.rateLimit.windowMs, max: config.rateLimit.adminMax });

  router.get('/', async (_req, res) => {
    res.json(await store.listDevices());
  });

  router.post('/', adminLimit, requireAdmin(config), async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) throw new HttpError(400, '"name" is required (max 80 chars)', { code: 'invalid_name' });
    res.status(201).json(await store.createDevice({ name }));
  });

  return router;
}

export function deviceAdminRouter({ config, store, logger }) {
  const router = Router();
  const adminLimit = rateLimit({ name: 'admin', windowMs: config.rateLimit.windowMs, max: config.rateLimit.adminMax });

  router.patch('/battery', adminLimit, requireAdmin(config), async (req, res) => {
    const deviceId = requireUuid(req.body?.device_id, 'device_id');
    const level = batteryLevel(req.body?.battery_level);

    const device = await store.updateDevice(deviceId, {
      battery_level: level,
      status: statusForBattery(level),
      battery_source: 'manual',
      battery_updated_at: new Date().toISOString(),
    });
    if (!device) throw new HttpError(404, `Device ${deviceId} not found`, { code: 'device_not_found' });

    logger.info('battery_manual_override', { device_id: deviceId, battery_level: level, request_id: req.id });
    res.json({ device, alert: level < LOW_BATTERY_THRESHOLD ? 'LOW_BATTERY' : null, threshold: LOW_BATTERY_THRESHOLD });
  });

  return router;
}
