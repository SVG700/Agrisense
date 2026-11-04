/**
 * Economic Impact Engine: what today's decision is worth to the farmer, in rupees.
 *
 *   WAIT / RELEASE BIOCONTROL  -> money saved by not spraying:
 *       spray cost (product + labour)  x acres
 *     + predators a spray would kill (only when predators are on the card)
 *     - the biocontrol release itself (RELEASE BIOCONTROL only)
 *   SPRAY                      -> yield value at risk if the warning is ignored:
 *       crop value (yield x price x acres) x weekly loss %, over the horizon,
 *       where weekly loss % = loss at the action level x (pests/day / action level),
 *       capped; set against the spray cost to give the return per rupee
 *   CHECK TRAP / no data       -> no estimate (the photo must be readable first)
 *
 * Every figure is an ESTIMATE from placeholder assumptions (backend/config/pests.json,
 * "economics"), each overridable per trap from the dashboard, and labelled as such.
 */
import { ECONOMICS_CONFIG } from './pestConfig.js';

const round0 = (n) => Math.round(n);
const round1 = (n) => Math.round(n * 10) / 10;

/** Settings from the dashboard (all optional), clamped to sane ranges; anything else falls back to the config. */
export function economicsSettings(input = {}, cfg = ECONOMICS_CONFIG) {
  const num = (v, lo, hi) => {
    const n = Number(v);
    return v === undefined || v === null || v === '' || !Number.isFinite(n) || n < lo || n > hi ? null : n;
  };
  const crop = cfg.crops[input.crop] ?? cfg.crops[cfg.defaultCrop] ?? Object.values(cfg.crops)[0];
  return {
    crop: crop.id,
    crop_label: crop.label,
    acres: num(input.acres, 0.01, 1000) ?? cfg.acresPerTrap,
    yield_kg_per_acre: num(input.yield, 1, 500_000) ?? crop.yieldKgPerAcre,
    price_inr_per_kg: num(input.price, 0.1, 10_000) ?? crop.priceInrPerKg,
    spray_cost_inr_per_acre: num(input.spray_cost, 1, 100_000) ?? cfg.sprayCostPerAcre,
    biocontrol_cost_inr_per_acre: num(input.biocontrol_cost, 0, 100_000) ?? cfg.biocontrolCostPerAcre,
    predator_value_inr_per_acre: cfg.predatorValuePerAcre,
    weekly_loss_pct_at_threshold: cfg.weeklyLossPctAtThreshold,
    max_weekly_loss_pct: cfg.maxWeeklyLossPct,
    horizon_days: cfg.horizonDays,
  };
}

/**
 * @param {object} decision  the trap's decision (decision, avg_pests, avg_predators, thresholds, no_predators, simulated)
 * @param {object} settings  from economicsSettings()
 */
export function evaluateEconomics(decision, settings) {
  const s = settings;
  const sprayCost = s.spray_cost_inr_per_acre * s.acres;
  const cropValue = s.yield_kg_per_acre * s.price_inr_per_kg * s.acres;
  const base = { decision: decision?.decision ?? null, estimate: true, simulated: Boolean(decision?.simulated), settings: s, currency: 'INR' };

  const d = decision?.decision;
  if (!d || d === 'CHECK_TRAP' || !Number.isFinite(decision?.avg_pests)) {
    return { ...base, kind: 'unknown', headline_inr: null, lines: [], note: 'No estimate until the trap has a readable, counted photo.' };
  }
  const threshold = decision.thresholds?.action_threshold_per_day ?? 25;
  const predatorsPresent = !decision.no_predators && (decision.avg_predators ?? 0) > 0;
  const predatorValue = predatorsPresent ? s.predator_value_inr_per_acre * s.acres : 0;

  if (d === 'WAIT' || d === 'BIOCONTROL') {
    const release = d === 'BIOCONTROL' ? s.biocontrol_cost_inr_per_acre * s.acres : 0;
    const saved = Math.max(0, sprayCost + predatorValue - release);
    const lines = [{ id: 'spray', label: 'Chemical spray not needed (product + labour)', inr: round0(sprayCost) }];
    if (predatorValue) lines.push({ id: 'predators', label: `Predators kept alive (${round1(decision.avg_predators)} per day on the card)`, inr: round0(predatorValue) });
    if (release) lines.push({ id: 'release', label: 'Biocontrol release to buy', inr: -round0(release) });
    return {
      ...base,
      kind: 'saved',
      headline_inr: round0(saved),
      headline: d === 'WAIT' ? 'Chemical spray avoided' : 'Spray replaced by biocontrol',
      period: 'today',
      lines,
      why:
        d === 'WAIT'
          ? predatorsPresent
            ? 'Pests are below the action level and predators are working - spraying now would cost money and kill them.'
            : 'Pests are below the action level - a spray now would be money spent for nothing.'
          : 'Predators are keeping pace - releasing more is cheaper than spraying and keeps the natural control.',
    };
  }

  // SPRAY: what ignoring the warning could cost over the horizon
  const pressure = decision.avg_pests / threshold;
  const weeklyLossPct = Math.min(s.max_weekly_loss_pct, s.weekly_loss_pct_at_threshold * pressure);
  const lossPct = weeklyLossPct * (s.horizon_days / 7);
  const atRisk = cropValue * (lossPct / 100);
  const net = atRisk - sprayCost;
  return {
    ...base,
    kind: 'at_risk',
    headline_inr: round0(atRisk),
    headline: 'Projected yield loss if ignored',
    period: `next ${s.horizon_days} days`,
    loss_pct: round1(lossPct),
    spray_cost_inr: round0(sprayCost),
    net_benefit_inr: round0(net),
    return_per_rupee: sprayCost > 0 ? round1(atRisk / sprayCost) : null,
    lines: [
      { id: 'crop', label: `Crop value on ${s.acres} acre${s.acres === 1 ? '' : 's'} (${s.crop_label})`, inr: round0(cropValue) },
      { id: 'loss', label: `Loss at ${round1(pressure)}x the action level: ${round1(lossPct)}% over ${s.horizon_days} days`, inr: -round0(atRisk) },
      { id: 'spray', label: 'Cost of spraying now', inr: -round0(sprayCost) },
    ],
    why: `Pests are at ${round1(decision.avg_pests)}/day, ${round1(pressure)}x the action level${predatorsPresent ? ', more than the predators can handle' : ' with no predators on the card'}.`,
  };
}

export const CROPS = () => Object.values(ECONOMICS_CONFIG.crops).map((c) => ({ id: c.id, label: c.label, yield_kg_per_acre: c.yieldKgPerAcre, price_inr_per_kg: c.priceInrPerKg }));
