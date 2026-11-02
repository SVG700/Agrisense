/**
 * Loads backend/config/pests.json once: class -> pest/predator mapping (with
 * model label aliases such as WF / MR / NC) and the decision thresholds.
 * Keeping these in a config file means the IIHR mentor's numbers can be
 * changed without touching code.
 */
import { readFileSync } from 'node:fs';

const raw = JSON.parse(readFileSync(new URL('../../config/pests.json', import.meta.url), 'utf8'));

const norm = (s) => String(s).trim().toLowerCase().replace(/[\s-]+/g, '_');

export const CLASSES = raw.classes.map((c) => ({ ...c, aliases: (c.aliases ?? []).map(norm) }));

/** alias (normalised) -> class definition */
const byAlias = new Map();
for (const c of CLASSES) {
  byAlias.set(norm(c.id), c);
  for (const a of c.aliases) byAlias.set(a, c);
}

/** Maps any model label ("WF", "Whitefly", "MR"...) to our class id, or the normalised label if unknown. */
export function canonicalLabel(label) {
  const n = norm(label);
  return byAlias.get(n)?.id ?? n;
}

/** 'pest' | 'predator'. Unknown classes are treated as pests (conservative). */
export function categoryOf(label) {
  return byAlias.get(norm(label))?.category ?? 'pest';
}

export const PREDATOR_IDS = new Set(CLASSES.filter((c) => c.category === 'predator').map((c) => c.id));

const d = raw.decision;
export const DECISION_CONFIG = Object.freeze({
  actionThresholdPerDay: Number(d.action_threshold_per_day),
  sprayRatio: Number(d.spray_ratio),
  rollingWindowDays: Number(d.rolling_window_days),
  countUncertainty: Number(d.count_uncertainty),
  countUncertaintyMin: Number(d.count_uncertainty_min),
  countUncertaintyMax: Number(d.count_uncertainty_max),
  placeholder: true, // every threshold is a placeholder until confirmed with the IIHR mentor
});
