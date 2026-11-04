/**
 * Weather route
 *   GET /api/weather?device_id=<uuid>   forecast at the trap (or the default farm location)
 *   GET /api/weather?lat=..&lon=..      forecast at a point (phone check / map)
 *   GET /api/weather/now?lat=..&lon=..  live temperature + humidity there (5-min cache)
 *   GET /api/places?q=..                address / village search -> [{label, lat, lon}]
 *   GET /api/places/reverse?lat=..&lon=..  place name for a point ("Use my location")
 *
 * Returns "Can I spray now?" with the next good window and whitefly
 * degree-days. Always 200: when Open-Meteo is unavailable the body says
 * {available:false} so the dashboard simply shows a note.
 */
import { Router } from 'express';
import { HttpError, isUuid } from '../utils/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';

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

  const point = (req) => {
    const la = coord(req.query.lat, -90, 90);
    const lo = coord(req.query.lon, -180, 180);
    if (la === null || lo === null) throw new HttpError(400, '"lat" and "lon" must be valid coordinates', { code: 'invalid_coordinates' });
    return { lat: la, lon: lo };
  };
  const placeLimit = rateLimit({ name: 'places', windowMs: config.rateLimit.windowMs, max: config.rateLimit.checkMax * 3 });

  router.get('/weather/now', async (req, res) => {
    const p = req.query.lat === undefined && req.query.lon === undefined
      ? { lat: config.weather.defaultLat, lon: config.weather.defaultLon, label: config.weather.defaultLabel }
      : { ...point(req), label: typeof req.query.label === 'string' ? req.query.label.slice(0, 120) : null };
    res.json(await weather.now(p));
  });

  router.get('/places', placeLimit, async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length < 2 || q.length > 120) throw new HttpError(400, '"q" must be 2-120 characters', { code: 'invalid_query' });
    res.json(await weather.searchPlaces(q));
  });

  router.get('/places/reverse', placeLimit, async (req, res) => {
    const p = point(req);
    res.json({ ...p, label: await weather.placeName(p.lat, p.lon) });
  });

  return router;
}
