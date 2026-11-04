/**
 * Economic impact of a trap's current decision (estimate)
 *   GET /api/economics?device_id=..&crop=&acres=&yield=&price=&spray_cost=&biocontrol_cost=
 *   GET /api/economics/crops      crop presets (yield, price) for the settings form
 *
 * Reads the trap's cached decision, so it is cheap to call on every dashboard refresh.
 */
import { Router } from 'express';
import { CROPS, economicsSettings, evaluateEconomics } from '../services/economics.js';
import { HttpError, isUuid } from '../utils/validate.js';
import { trapDecision } from './map.js';

export function economicsRouter({ store }) {
  const router = Router();

  router.get('/economics/crops', (_req, res) => res.json(CROPS()));

  router.get('/economics', async (req, res) => {
    const { device_id: deviceId } = req.query;
    if (!isUuid(deviceId)) throw new HttpError(400, '"device_id" must be a UUID', { code: 'invalid_device_id' });
    if (!(await store.getDevice(deviceId))) throw new HttpError(404, 'Unknown trap', { code: 'unknown_device' });
    const decision = await trapDecision({ store }, deviceId);
    res.json(evaluateEconomics(decision, economicsSettings(req.query)));
  });

  return router;
}
