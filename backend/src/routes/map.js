/**
 * Pest Surveillance Map routes
 *   GET    /api/map-data?days=30      one row per trap per day (public read, like the dashboard)
 *   GET    /api/decision?device_id=   current predator-aware decision for one trap (last N days)
 *   GET    /api/impact?days=30        impact ESTIMATE vs calendar spraying, all traps
 *   GET    /api/decision/simulate     what-if: same engine on hypothetical pests/predators per day
 *   GET    /api/decision/regions      decision map over a pests x predators grid
 *   POST   /api/admin/map-seed        load SIMULATED traps + daily counts (admin; used by demo/seed.py)
 *   DELETE /api/admin/map-seed        remove all simulated traps and their observations (admin)
 *   PATCH  /api/device/location       set a real trap's coordinates (admin)
 *
 * Rows come from two places:
 *   - trap_daily_observations (seeded demo history, always simulated=true)
 *   - real captures, aggregated per trap per UTC day for traps with coordinates
 * Decisions are always computed here (services/decision.js), never trusted from clients.
 */
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import {
  DECISIONS,
  THRESHOLDS,
  aggregateDaily,
  dailySeries,
  decide,
  evaluateDecision,
  rollingDecisions,
  withTrapCheck,
} from '../services/decision.js';
import { estimateImpact } from '../services/impact.js';
import { DECISION_CONFIG } from '../services/pestConfig.js';
import { HttpError, StoreError, isUuid, requireUuid } from '../utils/validate.js';

const MAX_DAYS = 120;
const MAX_TRAPS = 200;
const MAX_OBSERVATIONS = 20000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isoDay = (d) => d.toISOString().slice(0, 10);

/** Non-negative per-day rate from a query string (what-if inputs). */
function rate(value, field) {
  const n = Number(value);
  if (value === undefined || value === '' || !Number.isFinite(n) || n < 0 || n > 100_000) {
    throw new HttpError(400, `"${field}" must be a number between 0 and 100000`, { code: 'invalid_' + field });
  }
  return n;
}

function fraction(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new HttpError(400, `"${field}" must be between 0 and 1`, { code: 'invalid_' + field });
  return n;
}

function coordinate(value, field, min, max) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new HttpError(422, `"${field}" must be a number between ${min} and ${max}`, { code: 'invalid_coordinates' });
  }
  return Math.round(value * 1e6) / 1e6;
}

function count(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > 100_000) {
    throw new HttpError(422, `"${field}" must be an integer between 0 and 100000`, { code: 'invalid_count' });
  }
  return value;
}

function day(value, field) {
  if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new HttpError(422, `"${field}" must be a YYYY-MM-DD date`, { code: 'invalid_date' });
  }
  if (Date.parse(`${value}T00:00:00Z`) > Date.now() + 86_400_000) {
    throw new HttpError(422, `"${field}" is in the future`, { code: 'invalid_date' });
  }
  return value;
}

/**
 * One row per trap per UTC day for the last `days` days, with the predator-aware
 * rolling decision: seeded observations + real captures (captures win). Shared by
 * /map-data and /impact so both always agree.
 */
export async function trapDayRows({ store, logger }, days, { requireCoords = true } = {}) {
  const since = isoDay(new Date(Date.now() - (days - 1) * 86_400_000));
  // Fetch a few extra days so the first visible days still get a full rolling window
  const fetchSince = isoDay(new Date(Date.parse(`${since}T00:00:00Z`) - (DECISION_CONFIG.rollingWindowDays - 1) * 86_400_000));
  const warnings = [];

  const devices = await store.listDevices({ includeSimulated: true });
  const byId = new Map(devices.map((d) => [d.id, d]));

  // Seeded history. A database without schema v3 has no table: report it, keep real data.
  let observations = [];
  try {
    observations = await store.listObservations({ since: fetchSince });
  } catch (err) {
    if (!(err instanceof StoreError)) throw err;
    warnings.push('trap_daily_observations unavailable - apply supabase/schema.sql (v3) to load seeded map data');
    logger.warn('map_observations_unavailable', { cause: err.cause?.message });
  }

  const rows = new Map();
  for (const o of observations) {
    const d = byId.get(o.device_id);
    if (!d || (requireCoords && (d.latitude == null || d.longitude == null))) continue;
    rows.set(`${o.device_id}|${o.date}`, {
      trap_id: o.device_id,
      trap_name: d.name,
      latitude: d.latitude,
      longitude: d.longitude,
      date: o.date,
      pest_count: o.pest_count,
      predator_count: o.predator_count,
      decision: o.decision,
      dominant_pest: o.dominant_pest ?? null,
      simulated: o.simulated === true || d.simulated === true,
      source: 'observations',
    });
  }

  // Real captures override seeded rows for the same trap/day
  const telemetry = await store.listTelemetry({ limit: 5000, sign: false });
  for (const r of aggregateDaily(telemetry, byId, { requireCoords })) {
    if (r.date < fetchSince) continue;
    rows.set(`${r.trap_id}|${r.date}`, r);
  }

  // Predator-aware rolling decision per trap (each day averages the last N days)
  const perTrap = new Map();
  for (const r of rows.values()) {
    if (!perTrap.has(r.trap_id)) perTrap.set(r.trap_id, []);
    perTrap.get(r.trap_id).push(r);
  }
  for (const list of perTrap.values()) {
    const series = list.map((r) => ({ date: r.date, pests: r.pest_count, predators: r.predator_count, confidence: r.confidence ?? null }));
    const byDate = new Map(rollingDecisions(series).map((x) => [x.date, x.result]));
    for (const r of list) {
      const res = byDate.get(r.date);
      r.decision = res?.decision ?? decide(r.pest_count, r.predator_count);
      r.decision_reason = res?.reason ?? null;
      r.borderline = Boolean(res?.borderline);
      delete r.confidence;
    }
  }
  for (const [k, r] of rows) if (r.date < since) rows.delete(k);

  const list = [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.trap_name.localeCompare(b.trap_name));
  return { list, since, warnings, devices };
}

/**
 * A trap's current predator-aware decision: seeded days + real captures over the
 * last N days, with CHECK TRAP from the latest capture. Used by /decision and the
 * action log (to record the advice shown when the farmer acted).
 */
export async function trapDecision({ store }, deviceId) {
  const fetchSince = isoDay(new Date(Date.now() - (MAX_DAYS - 1) * 86_400_000));
  const byDate = new Map();
  try {
    for (const o of await store.listObservations({ since: fetchSince })) {
      if (o.device_id !== deviceId) continue;
      byDate.set(o.date, { date: o.date, pests: o.pest_count, predators: o.predator_count, confidence: null, simulated: true });
    }
  } catch (err) {
    if (!(err instanceof StoreError)) throw err;
  }
  const telemetry = await store.listTelemetry({ deviceId, limit: 500, sign: false });
  for (const d of dailySeries(telemetry)) byDate.set(d.date, d);
  const days = [...byDate.values()];
  // The latest real capture decides CHECK TRAP (failed / uncounted photo, or trap gone quiet)
  const last = telemetry.at(-1);
  const meta = last?.detection?.vision_meta;
  const latest = last ? { status: meta?.status, timestamp: last.timestamp, reason: meta?.quality?.reason ?? undefined } : null;
  const result = withTrapCheck(evaluateDecision(days), latest);
  const used = days.filter((d) => result.window.from && d.date >= result.window.from && d.date <= result.window.to);
  return { device_id: deviceId, ...result, simulated: used.some((d) => d.simulated), days: used };
}

export function mapRouter({ config, store, logger }) {
  const router = Router();
  const adminLimit = rateLimit({ name: 'admin', windowMs: config.rateLimit.windowMs, max: config.rateLimit.adminMax });

  router.get('/map-data', async (req, res) => {
    const days = Math.min(MAX_DAYS, Math.max(1, Number.parseInt(req.query.days, 10) || 30));
    const { list, since, warnings, devices } = await trapDayRows({ store, logger }, days);
    const traps = new Set(list.map((r) => r.trap_id));
    const unlocated = devices.filter((d) => d.simulated !== true && (d.latitude == null || d.longitude == null)).length;
    if (unlocated) warnings.push(`${unlocated} trap(s) have no coordinates and are not shown - set them with PATCH /api/device/location`);

    res.json({
      rows: list,
      meta: {
        days,
        since,
        generated_at: new Date().toISOString(),
        trap_count: traps.size,
        row_count: list.length,
        simulated: list.some((r) => r.simulated),
        all_simulated: list.length > 0 && list.every((r) => r.simulated),
        decisions: DECISIONS,
        thresholds: THRESHOLDS,
        warnings,
      },
    });
  });

  // Impact ESTIMATE vs calendar spraying, over every trap (with or without coordinates)
  router.get('/impact', async (req, res) => {
    const days = Math.min(MAX_DAYS, Math.max(7, Number.parseInt(req.query.days, 10) || 30));
    const { list, since, warnings } = await trapDayRows({ store, logger }, days, { requireCoords: false });
    res.json({ days, since, generated_at: new Date().toISOString(), ...estimateImpact(list), warnings });
  });

  // What-if: the SAME engine on hypothetical daily averages (pure computation, nothing stored)
  router.get('/decision/simulate', (req, res) => {
    const pests = rate(req.query.pests, 'pests');
    const predators = rate(req.query.predators, 'predators');
    const confidence = req.query.confidence === undefined ? null : fraction(req.query.confidence, 'confidence');
    // A full window of identical days = "if the N-day average were ..."
    const n = DECISION_CONFIG.rollingWindowDays;
    const days = Array.from({ length: n }, (_, i) => ({ date: `sim-${i}`, pests, predators, confidence }));
    const result = evaluateDecision(days);
    res.json({ ...result, inputs: { pests_per_day: pests, predators_per_day: predators, confidence }, window: { ...result.window, from: null, to: null } });
  });

  // Decision map: which advice the engine gives across a grid of pests/day x predators/day
  router.get('/decision/regions', (req, res) => {
    const maxPests = rate(req.query.max_pests ?? 100, 'max_pests') || 100;
    const maxPred = rate(req.query.max_predators ?? 20, 'max_predators') || 20;
    const steps = Math.min(60, Math.max(4, Number.parseInt(req.query.steps, 10) || 40));
    const axis = (max) => Array.from({ length: steps + 1 }, (_, i) => Math.round(((max * i) / steps) * 100) / 100);
    const pests = axis(maxPests);
    const predators = axis(maxPred);
    // rows = predators (low -> high), columns = pests (low -> high)
    const cells = predators.map((r) => pests.map((p) => decide(p, r)));
    res.json({ pests, predators, cells, thresholds: THRESHOLDS });
  });

  // Current predator-aware decision for one trap (seeded days + real captures, last N days)
  router.get('/decision', async (req, res) => {
    const deviceId = requireUuid(req.query.device_id, 'device_id');
    res.json(await trapDecision({ store }, deviceId));
  });

  router.post('/admin/map-seed', adminLimit, requireAdmin(config), async (req, res) => {
    const { traps, observations } = req.body ?? {};
    if (!Array.isArray(traps) || traps.length === 0 || traps.length > MAX_TRAPS) {
      throw new HttpError(400, `"traps" must be an array of 1-${MAX_TRAPS} items`, { code: 'invalid_traps' });
    }
    if (!Array.isArray(observations) || observations.length > MAX_OBSERVATIONS) {
      throw new HttpError(400, `"observations" must be an array of at most ${MAX_OBSERVATIONS} items`, { code: 'invalid_observations' });
    }

    const devices = traps.map((t, i) => {
      if (!isUuid(t?.id)) throw new HttpError(422, `traps[${i}].id must be a UUID`, { code: 'invalid_trap_id' });
      const name = typeof t.name === 'string' ? t.name.trim() : '';
      if (!name || name.length > 80) throw new HttpError(422, `traps[${i}].name is required (max 80 chars)`, { code: 'invalid_name' });
      return {
        id: t.id.toLowerCase(),
        name,
        latitude: coordinate(t.latitude, `traps[${i}].latitude`, -90, 90),
        longitude: coordinate(t.longitude, `traps[${i}].longitude`, -180, 180),
        simulated: true, // this endpoint only ever creates simulated traps
      };
    });
    const ids = new Set(devices.map((d) => d.id));

    // Never let the seed overwrite a real trap
    const existing = await store.listDevices({ includeSimulated: true });
    const clash = existing.find((d) => ids.has(d.id) && d.simulated !== true);
    if (clash) throw new HttpError(409, `Trap ${clash.id} is a real device and cannot be seeded`, { code: 'real_device_conflict' });

    const tally = Object.fromEntries(DECISIONS.map((d) => [d, 0]));
    const rows = observations.map((o, i) => {
      const deviceId = typeof o?.trap_id === 'string' ? o.trap_id.toLowerCase() : '';
      if (!ids.has(deviceId)) throw new HttpError(422, `observations[${i}].trap_id is not in "traps"`, { code: 'unknown_trap' });
      const pest = count(o.pest_count, `observations[${i}].pest_count`);
      const predator = count(o.predator_count ?? 0, `observations[${i}].predator_count`);
      const decision = decide(pest, predator);
      tally[decision]++;
      return {
        device_id: deviceId,
        date: day(o.date, `observations[${i}].date`),
        pest_count: pest,
        predator_count: predator,
        dominant_pest: typeof o.dominant_pest === 'string' ? o.dominant_pest.slice(0, 40) : null,
        decision,
        simulated: true,
      };
    });

    await store.upsertDevices(devices);
    if (rows.length) await store.upsertObservations(rows);
    logger.info('map_seed_loaded', { traps: devices.length, observations: rows.length, request_id: req.id });
    res.status(201).json({ traps: devices.length, observations: rows.length, decisions: tally, simulated: true });
  });

  router.delete('/admin/map-seed', adminLimit, requireAdmin(config), async (req, res) => {
    const removed = await store.deleteSimulatedDevices();
    logger.info('map_seed_removed', { traps: removed.length, request_id: req.id });
    res.json({ removed_traps: removed.length });
  });

  router.patch('/device/location', adminLimit, requireAdmin(config), async (req, res) => {
    const deviceId = requireUuid(req.body?.device_id, 'device_id');
    const { latitude, longitude } = req.body ?? {};
    const clear = latitude === null && longitude === null;
    const patch = clear
      ? { latitude: null, longitude: null }
      : { latitude: coordinate(latitude, 'latitude', -90, 90), longitude: coordinate(longitude, 'longitude', -180, 180) };
    const device = await store.updateDevice(deviceId, patch);
    if (!device) throw new HttpError(404, `Device ${deviceId} not found`, { code: 'device_not_found' });
    res.json({ device });
  });

  return router;
}
