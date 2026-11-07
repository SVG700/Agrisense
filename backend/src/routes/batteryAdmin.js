/**
 * Battery-only admin portal (frontend page /battery-admin).
 *   POST  /api/battery-admin/login                       {id, password} -> {token, expires_at}
 *   GET   /api/battery-admin/devices                     traps with their battery fields      (token)
 *   PATCH /api/battery-admin/devices/:id/battery         {battery_level: 0-100}               (token)
 *
 * The login (BATTERY_ADMIN_ID / BATTERY_ADMIN_PASSWORD in backend/.env) is separate from the
 * admin key and can ONLY change battery levels: its token is accepted by these routes and nowhere
 * else. Tokens are signed with a key derived from the password: restarts keep sessions, a new
 * password ends them.
 * Changes are stored exactly like the Admin & Hardware override (battery_source 'manual' + time).
 */
import { Router } from 'express';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { LOW_BATTERY_THRESHOLD } from '../config.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError, batteryLevel, requireUuid, statusForBattery } from '../utils/validate.js';

const sameText = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());

export function batteryAdminRouter({ config, store, logger }) {
  const router = Router();
  const ba = config.auth.batteryAdmin;
  // Signing key derived from the portal password: sessions survive backend restarts, and changing
  // BATTERY_ADMIN_PASSWORD signs everyone out. Never sent anywhere.
  const secret = createHash('sha256').update(`agrisense-battery-portal|${ba.id}|${ba.password}`).digest();
  const sign = (payload) => createHmac('sha256', secret).update(payload).digest('base64url');
  // 10 login attempts per 15 minutes per address
  const loginLimit = rateLimit({ name: 'battery_login', windowMs: 15 * 60_000, max: 10 });
  const limit = rateLimit({ name: 'battery_admin', windowMs: config.rateLimit.windowMs, max: config.rateLimit.adminMax });

  const enabled = (_req, _res, next) =>
    ba.password ? next() : next(new HttpError(503, 'The battery portal is off - set BATTERY_ADMIN_PASSWORD in backend/.env and restart', { code: 'battery_admin_disabled' }));

  function requireToken(req, _res, next) {
    const token = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const [scope, exp, sig] = token.split('.');
    const valid = scope === 'battery' && sig && Number(exp) > Date.now() && sameText(sig, sign(`battery.${exp}`));
    if (!valid) return next(new HttpError(401, 'Please sign in to the battery portal again', { code: 'battery_session_invalid' }));
    next();
  }

  router.post('/battery-admin/login', enabled, loginLimit, (req, res) => {
    const id = typeof req.body?.id === 'string' ? req.body.id.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    // Compare both even when the first fails, so timing does not reveal a valid ID
    const ok = sameText(id, ba.id) & sameText(password, ba.password);
    if (!ok) {
      logger.warn('battery_admin_login_failed', { request_id: req.id });
      throw new HttpError(401, 'Wrong ID or password', { code: 'battery_login_failed' });
    }
    const exp = Date.now() + ba.sessionHours * 3_600_000;
    logger.info('battery_admin_login', { request_id: req.id });
    res.json({ token: `battery.${exp}.${sign(`battery.${exp}`)}`, expires_at: new Date(exp).toISOString(), id: ba.id });
  });

  router.get('/battery-admin/devices', enabled, limit, requireToken, async (_req, res) => {
    const devices = await store.listDevices();
    res.json(devices.map((d) => ({
      id: d.id, name: d.name, status: d.status, battery_level: d.battery_level ?? null,
      battery_source: d.battery_source ?? null, battery_updated_at: d.battery_updated_at ?? null,
    })));
  });

  router.patch('/battery-admin/devices/:id/battery', enabled, limit, requireToken, async (req, res) => {
    const deviceId = requireUuid(req.params.id, 'id');
    const level = batteryLevel(req.body?.battery_level);
    const device = await store.updateDevice(deviceId, {
      battery_level: level,
      status: statusForBattery(level),
      battery_source: 'manual',
      battery_updated_at: new Date().toISOString(),
    });
    if (!device) throw new HttpError(404, `Trap ${deviceId} not found`, { code: 'device_not_found' });
    logger.info('battery_manual_override', { device_id: deviceId, battery_level: level, via: 'battery-portal', request_id: req.id });
    res.json({
      device: { id: device.id, name: device.name, status: device.status, battery_level: device.battery_level, battery_source: device.battery_source, battery_updated_at: device.battery_updated_at },
      alert: level < LOW_BATTERY_THRESHOLD ? 'LOW_BATTERY' : null,
      threshold: LOW_BATTERY_THRESHOLD,
    });
  });

  return router;
}
