/**
 * API-key authentication.
 *
 *   Devices: `Authorization: Bearer <key>` or `X-Device-Key: <key>`, matched
 *            against DEVICE_API_KEYS. The admin key is also accepted so the
 *            dashboard's capture simulator can ingest on a device's behalf.
 *   Admin:   `Authorization: Bearer <key>` or `X-Admin-Key: <key>`, matched
 *            against ADMIN_API_KEY.
 *
 * When a key list is empty and DEMO_MODE is on, the check is skipped
 * (config validation refuses to start without keys outside demo mode).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { HttpError } from '../utils/validate.js';

const digest = (s) => createHash('sha256').update(String(s)).digest();

/** Constant-time comparison against every candidate key. */
function matchesAny(provided, keys) {
  if (!provided) return false;
  const p = digest(provided);
  let ok = false;
  for (const k of keys) ok = timingSafeEqual(p, digest(k)) || ok;
  return ok;
}

function bearer(req) {
  const h = req.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

/**
 * Sets req.auth = { role: 'device'|'admin'|'demo', deviceId: string|null }.
 * deviceId is set when the matching key was bound to one device
 * ("<uuid>:<key>" in DEVICE_API_KEYS); the route then refuses other device_ids.
 */
export function requireDevice(config) {
  const devices = config.auth.devices ?? config.auth.deviceKeys.map((key) => ({ key, deviceId: null }));
  return (req, _res, next) => {
    if (!devices.length && config.demoMode) {
      req.auth = { role: 'demo', deviceId: null };
      return next();
    }
    const provided = req.get('x-device-key') || bearer(req);
    if (!provided) return next(new HttpError(401, 'Missing device credentials', { code: 'unauthorized' }));
    if (config.auth.adminKey && matchesAny(provided, [config.auth.adminKey])) {
      req.auth = { role: 'admin', deviceId: null };
      return next();
    }
    // Check every entry (constant work per request) and remember the match
    const p = digest(provided);
    let match = null;
    for (const d of devices) if (timingSafeEqual(p, digest(d.key)) && !match) match = d;
    if (!match) return next(new HttpError(403, 'Invalid device credentials', { code: 'forbidden' }));
    req.auth = { role: 'device', deviceId: match.deviceId };
    next();
  };
}

export function requireAdmin(config) {
  return (req, _res, next) => {
    if (!config.auth.adminKey && config.demoMode) return next();
    const provided = req.get('x-admin-key') || bearer(req);
    if (!provided) return next(new HttpError(401, 'Missing admin credentials', { code: 'unauthorized' }));
    if (!matchesAny(provided, [config.auth.adminKey])) {
      return next(new HttpError(403, 'Invalid admin credentials', { code: 'forbidden' }));
    }
    next();
  };
}
