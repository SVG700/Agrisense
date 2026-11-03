/**
 * Weather route
 *   GET /api/weather?device_id=<uuid>   forecast at the trap (or the default farm location)
 *   GET /api/weather?lat=..&lon=..      forecast at a point (phone check / map)
 *
 * Returns "Can I spray now?" with the next good window and whitefly
 * degree-days. Always 200: when Open-Meteo is unavailable the body says
 * {available:false} so the dashboard simply shows a note.
 */
import { Router } from 'express';
import { HttpError, isUuid } from '../utils/validate.js';

const coord = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1e4) / 1e4 : null;
};

export function weatherRouter({ config, store, weather }) {
  const router = Router();

  router.get('/weather', async (req, res) => {
    const { device_id: deviceId, lat, lon } = req.query;
    let point = null;
    if (lat !== undefined || lon !== undefined) {
      const la = coord(lat, -90, 90);
      const lo = coord(lon, -180, 180);
      if (la === null || lo === null) throw new HttpError(400, '"lat" and "lon" must be valid coordinates', { code: 'invalid_coordinates' });
      point = { lat: la, lon: lo, label: 'Selected location' };
    } else if (deviceId !== undefined) {
      if (!isUuid(deviceId)) throw new HttpError(400, '"device_id" must be a UUID', { code: 'invalid_device_id' });
      const d = await store.getDevice(deviceId);
      if (d?.latitude != null && d?.longitude != null) point = { lat: d.latitude, lon: d.longitude, label: d.name };
    }
    point ??= { lat: config.weather.defaultLat, lon: config.weather.defaultLon, label: config.weather.defaultLabel, default: true };
    res.json(await weather.forLocation(point));
  });

  return router;
}
