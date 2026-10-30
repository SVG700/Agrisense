/**
 * Map decision rule: one daily action per trap from pest vs natural-enemy counts.
 *
 *   SPRAY       pest_count >= SPRAY_MIN and natural enemies too few to keep up
 *   BIOCONTROL  pest pressure is building (>= BIOCONTROL_MIN), or high pressure
 *               that predators are already catching up with
 *   WAIT        below the monitoring threshold
 *
 * These thresholds are ILLUSTRATIVE demo values for yellow sticky traps, not
 * validated economic thresholds - see DECISIONS.md. Keep this the single source
 * of truth: the seed script sends raw counts and the backend decides.
 */

export const DECISIONS = ['SPRAY', 'BIOCONTROL', 'WAIT'];

export const THRESHOLDS = {
  SPRAY_MIN: 40, // pests per trap per day
  BIOCONTROL_MIN: 15,
  PREDATOR_RATIO_OK: 0.15, // >= 0.15 natural enemies per pest: let biocontrol work
};

/** Classes the vision model may return that are beneficial (not pests). */
export const PREDATOR_CLASSES = new Set([
  'ladybird',
  'ladybug',
  'lady_beetle',
  'lacewing',
  'hoverfly',
  'parasitoid_wasp',
  'encarsia',
  'spider',
  'predatory_mite',
]);

export function decide(pestCount, predatorCount) {
  const pests = Math.max(0, Number(pestCount) || 0);
  const predators = Math.max(0, Number(predatorCount) || 0);
  const ratio = predators / Math.max(pests, 1);
  if (pests >= THRESHOLDS.SPRAY_MIN && ratio < THRESHOLDS.PREDATOR_RATIO_OK) return 'SPRAY';
  if (pests >= THRESHOLDS.BIOCONTROL_MIN) return 'BIOCONTROL';
  return 'WAIT';
}

/** Splits a capture's per-class counts into pests vs natural enemies. */
export function splitCounts(counts) {
  let pests = 0;
  let predators = 0;
  const byPest = {};
  for (const [label, n] of Object.entries(counts ?? {})) {
    const v = Number(n) || 0;
    if (PREDATOR_CLASSES.has(label)) predators += v;
    else {
      pests += v;
      byPest[label] = (byPest[label] ?? 0) + v;
    }
  }
  const dominant = Object.entries(byPest).sort((a, b) => b[1] - a[1])[0];
  return { pests, predators, dominant: dominant && dominant[1] > 0 ? dominant[0] : null };
}

/**
 * Rolls real captures up to one row per trap per UTC day (max per-capture
 * count per day, so several captures of the same sticky card aren't summed).
 * Only captures whose counts are meaningful (model or simulated detections).
 */
export function aggregateDaily(telemetryRows, devicesById) {
  const days = new Map();
  for (const t of telemetryRows) {
    const det = t.detection;
    const status = det?.vision_meta?.status;
    if (!det || !['ok', 'simulated', undefined].includes(status)) continue;
    const device = devicesById.get(t.device_id);
    if (!device || device.latitude == null || device.longitude == null) continue;
    const date = new Date(t.timestamp).toISOString().slice(0, 10);
    const { pests, predators, dominant } = splitCounts(det.pest_counts);
    const key = `${t.device_id}|${date}`;
    const prev = days.get(key);
    if (!prev || pests > prev.pest_count) {
      days.set(key, {
        trap_id: t.device_id,
        trap_name: device.name,
        latitude: device.latitude,
        longitude: device.longitude,
        date,
        pest_count: pests,
        predator_count: predators,
        dominant_pest: dominant,
        simulated: status === 'simulated' || t.data_source === 'simulator' || t.data_source === 'dashboard',
        source: 'captures',
      });
    }
  }
  return [...days.values()];
}
