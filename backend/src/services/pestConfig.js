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

/** 'pest' | 'predator' | 'beneficial' | 'neutral'. Unknown classes are treated as pests (conservative). */
export function categoryOf(label) {
  return byAlias.get(norm(label))?.category ?? 'pest';
}

export const PREDATOR_IDS = new Set(CLASSES.filter((c) => c.category === 'predator').map((c) => c.id));
/** Helpful (bees, earthworms) or neutral (caddisflies) classes: reported, but counted as neither pest nor predator. */
export const BENEFICIAL_IDS = new Set(CLASSES.filter((c) => c.category === 'beneficial' || c.category === 'neutral').map((c) => c.id));
/** Class ids a model group reports, e.g. 'agropest12' (the AgroPest-12 inference service). */
export const classIdsOfGroup = (group) => CLASSES.filter((c) => c.group === group).map((c) => c.id);

const d = raw.decision;
export const DECISION_CONFIG = Object.freeze({
  actionThresholdPerDay: Number(d.action_threshold_per_day),
  sprayRatio: Number(d.spray_ratio),
  rollingWindowDays: Number(d.rolling_window_days),
  countUncertainty: Number(d.count_uncertainty),
  countUncertaintyMin: Number(d.count_uncertainty_min),
  countUncertaintyMax: Number(d.count_uncertainty_max),
  checkTrapAfterHours: Number(d.check_trap_after_hours ?? 48),
  placeholder: true, // every threshold is a placeholder until confirmed with the IIHR mentor
});

const sw = raw.spray_window ?? {};
export const SPRAY_CONFIG = Object.freeze({
  rainLookaheadHours: Number(sw.rain_lookahead_hours ?? 6),
  maxRainProbability: Number(sw.max_rain_probability ?? 40),
  maxRainMm: Number(sw.max_rain_mm ?? 0.2),
  maxWindKmh: Number(sw.max_wind_kmh ?? 15),
  minWindKmh: Number(sw.min_wind_kmh ?? 2),
  maxGustKmh: Number(sw.max_gust_kmh ?? 25),
  maxTempC: Number(sw.max_temp_c ?? 32),
  minWindowHours: Number(sw.min_window_hours ?? 2),
  searchHours: Number(sw.search_hours ?? 72),
});

const dd = raw.degree_days ?? {};
export const DEGREE_DAY_CONFIG = Object.freeze({
  pest: String(dd.pest ?? 'whitefly'),
  baseTempC: Number(dd.base_temp_c ?? 10),
  upperTempC: Number(dd.upper_temp_c ?? 32),
  generationDegreeDays: Number(dd.generation_degree_days ?? 300),
});

const q = raw.image_quality ?? {};
export const QUALITY_CONFIG = Object.freeze({
  analysisWidth: Number(q.analysis_width ?? 1024),
  minSharpness: Number(q.min_sharpness ?? 30),
  minBrightness: Number(q.min_brightness ?? 45),
  maxBrightness: Number(q.max_brightness ?? 235),
  maxGlareFraction: Number(q.max_glare_fraction ?? 0.08),
  glareLevel: Number(q.glare_level ?? 240),
});

const im = raw.impact ?? {};
export const IMPACT_CONFIG = Object.freeze({
  calendarIntervalDays: Number(im.calendar_spray_interval_days ?? 7),
  sprayReapplyDays: Number(im.spray_reapply_days ?? 7),
  releaseIntervalDays: Number(im.release_interval_days ?? 7),
  areaPerTrapAcres: Number(im.area_per_trap_acres ?? 0.5),
  productLitresPerAcrePerSpray: Number(im.product_litres_per_acre_per_spray ?? 0.25),
  costPerAcrePerSpray: Number(im.cost_inr_per_acre_per_spray ?? 1500),
  currency: String(im.currency ?? 'INR'),
});

const ec = raw.economics ?? {};
export const ECONOMICS_CONFIG = Object.freeze({
  defaultCrop: String(ec.default_crop ?? 'tomato'),
  crops: Object.freeze(
    Object.fromEntries(
      Object.entries(ec.crops ?? {}).map(([id, c]) => [id, Object.freeze({ id, label: String(c.label ?? id), yieldKgPerAcre: Number(c.yield_kg_per_acre), priceInrPerKg: Number(c.price_inr_per_kg) })])
    )
  ),
  acresPerTrap: Number(ec.acres_per_trap ?? 0.5),
  sprayCostPerAcre: Number(ec.spray_cost_inr_per_acre ?? 1500),
  biocontrolCostPerAcre: Number(ec.biocontrol_cost_inr_per_acre ?? 900),
  predatorValuePerAcre: Number(ec.predator_value_inr_per_acre ?? 1200),
  weeklyLossPctAtThreshold: Number(ec.weekly_loss_pct_at_threshold ?? 2),
  maxWeeklyLossPct: Number(ec.max_weekly_loss_pct ?? 15),
  horizonDays: Number(ec.horizon_days ?? 7),
});
