/**
 * Predator-aware decision engine (single source of truth for SPRAY /
 * RELEASE BIOCONTROL / WAIT across the dashboard, map, phone check and
 * what-if tools).
 *
 *   avg pests/day over the last N days  >= action threshold
 *     AND pests per predator            >= spray ratio      -> SPRAY
 *   avg pests/day                       >= action threshold
 *     AND pests per predator            <  spray ratio      -> BIOCONTROL ("RELEASE BIOCONTROL")
 *   avg pests/day                       <  action threshold -> WAIT
 *
 * Every result carries a plain-language reason, the count range implied by
 * detection uncertainty, and a BORDERLINE flag when the advice could flip
 * inside that range. Thresholds live in backend/config/pests.json and are
 * placeholders until confirmed with the ICAR-IIHR mentor.
 */
import { DECISION_CONFIG, PREDATOR_IDS, canonicalLabel } from './pestConfig.js';

export const DECISIONS = ['SPRAY', 'BIOCONTROL', 'WAIT'];

export const DECISION_LABELS = {
  SPRAY: 'SPRAY',
  BIOCONTROL: 'RELEASE BIOCONTROL',
  WAIT: 'WAIT',
  CHECK_TRAP: 'CHECK TRAP',
};

const CHECK_TRAP_REASONS = {
  failed: 'The last trap photo could not be analysed (detection failed). Check the camera and the sticky card, then take a new photo.',
  not_configured: 'Insects in the last photo were not counted because no detector is set up. Count the card by eye or configure the detector.',
  skipped: 'The last capture had no trap photo. Check that the camera is working.',
};

/**
 * CHECK TRAP overrides the count-based decision when the latest capture could
 * not be counted, or the trap has gone quiet. The count-based result is kept
 * as `last_counted` so the farmer still sees the last known advice.
 * @param {object} counted   evaluateDecision(...) result
 * @param {{status?: string, timestamp?: string, reason?: string}|null} latest  latest capture (vision status) or null
 */
export function withTrapCheck(counted, latest, { now = Date.now(), cfg = DECISION_CONFIG } = {}) {
  if (!latest) return counted;
  let reason = latest.reason ?? CHECK_TRAP_REASONS[latest.status] ?? null;
  const ageH = (now - Date.parse(latest.timestamp)) / 3_600_000;
  if (!reason && Number.isFinite(ageH) && ageH > cfg.checkTrapAfterHours) {
    reason = `No capture for ${Math.round(ageH)} hours. Check that the trap device is powered and online.`;
  }
  if (!reason) return counted;
  return {
    decision: 'CHECK_TRAP',
    label: DECISION_LABELS.CHECK_TRAP,
    reason,
    borderline: false,
    check_trap: true,
    last_counted: counted.decision ? { decision: counted.decision, label: counted.label, reason: counted.reason } : null,
    window: counted.window,
    thresholds: counted.thresholds,
  };
}

/** Thresholds as exposed by the API (snake_case, marked as placeholders). */
export const THRESHOLDS = {
  action_threshold_per_day: DECISION_CONFIG.actionThresholdPerDay,
  spray_ratio: DECISION_CONFIG.sprayRatio,
  rolling_window_days: DECISION_CONFIG.rollingWindowDays,
  placeholder: 'to confirm with IIHR mentor',
};

const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** The rule for one (pests/day, predators/day) point. */
function ruleAt(pests, predators, cfg) {
  if (pests < cfg.actionThresholdPerDay) return 'WAIT';
  const ratio = predators > 0 ? pests / predators : Infinity;
  return ratio >= cfg.sprayRatio ? 'SPRAY' : 'BIOCONTROL';
}

/** Single-day decision (kept for stored seed rows; the live views use evaluateDecision). */
export function decide(pestCount, predatorCount, cfg = DECISION_CONFIG) {
  return ruleAt(Math.max(0, Number(pestCount) || 0), Math.max(0, Number(predatorCount) || 0), cfg);
}

function ratioText(ratio) {
  if (!Number.isFinite(ratio)) return 'no predators on the trap';
  if (ratio < 1) return `more predators than pests (${round1(1 / ratio)} predators per pest)`;
  return `about ${round1(ratio)} pests for every predator`;
}

/**
 * @param {{date: string, pests: number, predators: number, confidence?: number|null}[]} days
 *        one entry per day with counts (any order)
 * @returns {object} decision result (decision is null when there is no data)
 */
export function evaluateDecision(days, cfg = DECISION_CONFIG) {
  const usable = (days ?? [])
    .filter((d) => Number.isFinite(d?.pests) && Number.isFinite(d?.predators))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const window = usable.slice(-cfg.rollingWindowDays);
  const thresholds = {
    action_threshold_per_day: cfg.actionThresholdPerDay,
    spray_ratio: cfg.sprayRatio,
    rolling_window_days: cfg.rollingWindowDays,
    placeholder: 'to confirm with IIHR mentor',
  };

  if (!window.length) {
    return {
      decision: null,
      label: 'NO DATA',
      reason: 'No counted trap images yet, so there is no recommendation.',
      borderline: false,
      window: { days: 0, requested: cfg.rollingWindowDays, from: null, to: null },
      thresholds,
    };
  }

  const n = window.length;
  const avgPests = window.reduce((s, d) => s + d.pests, 0) / n;
  const avgPredators = window.reduce((s, d) => s + d.predators, 0) / n;
  const confs = window.map((d) => d.confidence).filter((c) => Number.isFinite(c));
  const meanConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  const u =
    meanConfidence === null
      ? cfg.countUncertainty
      : clamp(1 - meanConfidence, cfg.countUncertaintyMin, cfg.countUncertaintyMax);

  const decision = ruleAt(avgPests, avgPredators, cfg);
  const ratio = avgPredators > 0 ? avgPests / avgPredators : Infinity;

  // Could the advice flip inside the count range? Check the extreme combinations.
  const pRange = [avgPests * (1 - u), avgPests * (1 + u)];
  const rRange = [avgPredators * (1 - u), avgPredators * (1 + u)];
  const possible = new Set();
  for (const p of pRange) for (const r of rRange) possible.add(ruleAt(p, r, cfg));
  possible.add(decision);
  const alternatives = [...possible].filter((d) => d !== decision);
  const borderline = alternatives.length > 0;

  const perDay = `${round1(avgPests)} pests/day`;
  const span = n === 1 ? 'on the latest day' : `over the last ${n} days`;
  const partial = n < cfg.rollingWindowDays ? ` (only ${n} of ${cfg.rollingWindowDays} days available so far)` : '';
  let reason;
  if (decision === 'WAIT') {
    reason = `Average ${perDay} ${span} is below the action level of ${cfg.actionThresholdPerDay}. Keep monitoring the trap.`;
  } else if (decision === 'SPRAY') {
    reason =
      `Average ${perDay} ${span} is above the action level of ${cfg.actionThresholdPerDay}, with ${ratioText(ratio)}. ` +
      `That is too many for natural enemies to control (spray level: ${cfg.sprayRatio} or more pests per predator), so spraying is advised.`;
  } else {
    reason =
      `Average ${perDay} ${span} is above the action level of ${cfg.actionThresholdPerDay}, but there are ${ratioText(ratio)} ` +
      `(below ${cfg.sprayRatio}), so natural enemies are keeping pace. Release more biocontrol instead of spraying, to protect them.`;
  }
  reason += partial;
  if (borderline) {
    reason += ` BORDERLINE: within the counting uncertainty (±${Math.round(u * 100)}%) the advice could be ${alternatives
      .map((a) => DECISION_LABELS[a])
      .join(' or ')}.`;
  }

  return {
    decision,
    label: DECISION_LABELS[decision],
    reason,
    avg_pests: round1(avgPests),
    avg_predators: round1(avgPredators),
    pests_per_predator: Number.isFinite(ratio) ? round1(ratio) : null,
    no_predators: !Number.isFinite(ratio),
    range: {
      pests: pRange.map(round1),
      predators: rRange.map(round1),
      uncertainty: round1(u * 100) / 100,
      mean_confidence: meanConfidence === null ? null : Math.round(meanConfidence * 1000) / 1000,
    },
    borderline,
    possible_decisions: [decision, ...alternatives],
    window: { days: n, requested: cfg.rollingWindowDays, from: window[0].date, to: window.at(-1).date },
    thresholds,
  };
}

/** Rolling decision for every day in a trap's series (each day uses the N days up to and including it). */
export function rollingDecisions(days, cfg = DECISION_CONFIG) {
  const sorted = [...days].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return sorted.map((d, i) => ({ date: d.date, result: evaluateDecision(sorted.slice(0, i + 1), cfg) }));
}

/** Splits a capture's per-class counts into pests vs predators (labels mapped through the class config). */
export function splitCounts(counts) {
  let pests = 0;
  let predators = 0;
  const byPest = {};
  for (const [label, n] of Object.entries(counts ?? {})) {
    const v = Number(n) || 0;
    const id = canonicalLabel(label);
    if (PREDATOR_IDS.has(id)) predators += v;
    else {
      pests += v;
      byPest[id] = (byPest[id] ?? 0) + v;
    }
  }
  const dominant = Object.entries(byPest).sort((a, b) => b[1] - a[1])[0];
  return { pests, predators, dominant: dominant && dominant[1] > 0 ? dominant[0] : null };
}

/** Mean confidence of the boxes that were counted in a capture (null if unknown). */
function captureConfidence(det) {
  const boxes = Array.isArray(det?.bounding_boxes) ? det.bounding_boxes : [];
  const c = boxes.map((b) => Number(b.confidence)).filter(Number.isFinite);
  return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null;
}

const countable = (det) => det && ['ok', 'simulated', undefined].includes(det?.vision_meta?.status);

/**
 * One device's captures -> one entry per UTC day (the capture with the most
 * pests that day, so repeated photos of the same card aren't summed).
 */
export function dailySeries(telemetryRows) {
  const days = new Map();
  for (const t of telemetryRows) {
    const det = t.detection;
    if (!countable(det)) continue;
    const date = new Date(t.timestamp).toISOString().slice(0, 10);
    const { pests, predators, dominant } = splitCounts(det.pest_counts);
    const prev = days.get(date);
    if (!prev || pests > prev.pests) {
      days.set(date, {
        date,
        pests,
        predators,
        dominant,
        confidence: captureConfidence(det),
        simulated: det?.vision_meta?.status === 'simulated' || t.data_source === 'simulator' || t.data_source === 'dashboard',
      });
    }
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Real captures for many devices -> map rows (one per trap per UTC day) for
 * traps that have coordinates. Decisions are added by the caller (rolling).
 */
export function aggregateDaily(telemetryRows, devicesById) {
  const perDevice = new Map();
  for (const t of telemetryRows) {
    const device = devicesById.get(t.device_id);
    if (!device || device.latitude == null || device.longitude == null) continue;
    if (!perDevice.has(t.device_id)) perDevice.set(t.device_id, []);
    perDevice.get(t.device_id).push(t);
  }
  const rows = [];
  for (const [deviceId, list] of perDevice) {
    const device = devicesById.get(deviceId);
    for (const d of dailySeries(list)) {
      rows.push({
        trap_id: deviceId,
        trap_name: device.name,
        latitude: device.latitude,
        longitude: device.longitude,
        date: d.date,
        pest_count: d.pests,
        predator_count: d.predators,
        dominant_pest: d.dominant,
        confidence: d.confidence,
        simulated: d.simulated,
        source: 'captures',
      });
    }
  }
  return rows;
}
