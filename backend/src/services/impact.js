/**
 * Impact ESTIMATE: what the predator-aware decisions would save compared with
 * routine calendar spraying (every 7 days whatever the pest level).
 *
 * Per trap, over the days it has data:
 *   calendar sprays    = ceil(days covered / calendar interval)
 *   AgriSense sprays   = one spray when the trap turns SPRAY, another if it is
 *                        still SPRAY after `sprayReapplyDays`
 *   biocontrol releases= the same, for RELEASE BIOCONTROL
 *   sprays avoided     = calendar - AgriSense (never below 0 per trap)
 * Litres of product and rupees saved scale sprays avoided by the area each
 * trap represents. Every number is an estimate from placeholder assumptions
 * in backend/config/pests.json (impact), and is labelled that way.
 */
import { IMPACT_CONFIG } from './pestConfig.js';

const DAY = 86_400_000;
const dayNum = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);
const round1 = (n) => Math.round(n * 10) / 10;

/** Applications needed for a run of decision days: one at the start, one more every `every` days. */
function applications(rows, decision, every) {
  let count = 0;
  let last = null;
  for (const r of rows) {
    if (r.decision !== decision) continue;
    const d = dayNum(r.date);
    if (last === null || d - last >= every) {
      count++;
      last = d;
    }
  }
  return count;
}

/**
 * @param {{trap_id, trap_name, date, decision, predator_count, simulated}[]} rows  one per trap per day (any order)
 * @param {object} [cfg]
 */
export function estimateImpact(rows, cfg = IMPACT_CONFIG) {
  const byTrap = new Map();
  for (const r of rows) {
    if (!byTrap.has(r.trap_id)) byTrap.set(r.trap_id, []);
    byTrap.get(r.trap_id).push(r);
  }

  const perTrap = [];
  for (const [trapId, list] of byTrap) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const covered = dayNum(list.at(-1).date) - dayNum(list[0].date) + 1;
    const calendar = Math.ceil(covered / cfg.calendarIntervalDays);
    const sprays = applications(list, 'SPRAY', cfg.sprayReapplyDays);
    const releases = applications(list, 'BIOCONTROL', cfg.releaseIntervalDays);
    perTrap.push({
      trap_id: trapId,
      trap_name: list[0].trap_name,
      days: covered,
      calendar_sprays: calendar,
      agrisense_sprays: sprays,
      biocontrol_releases: releases,
      sprays_avoided: Math.max(0, calendar - sprays),
      // Days a spray was NOT advised although pests were high, because predators were keeping pace
      predator_protected_days: list.filter((r) => r.decision === 'BIOCONTROL').length,
      simulated: list.some((r) => r.simulated),
    });
  }
  perTrap.sort((a, b) => b.sprays_avoided - a.sprays_avoided || a.trap_name.localeCompare(b.trap_name));

  const sum = (k) => perTrap.reduce((s, t) => s + t[k], 0);
  const calendar = sum('calendar_sprays');
  const avoided = sum('sprays_avoided');
  const acreSprays = avoided * cfg.areaPerTrapAcres;
  return {
    estimate: true,
    traps: perTrap.length,
    trap_days: rows.length,
    calendar_sprays: calendar,
    agrisense_sprays: sum('agrisense_sprays'),
    biocontrol_releases: sum('biocontrol_releases'),
    sprays_avoided: avoided,
    percent_fewer_sprays: calendar ? Math.round((avoided / calendar) * 100) : 0,
    product_litres_saved: round1(acreSprays * cfg.productLitresPerAcrePerSpray),
    cost_saved: Math.round(acreSprays * cfg.costPerAcrePerSpray),
    currency: cfg.currency,
    predator_protected_days: sum('predator_protected_days'),
    simulated: perTrap.some((t) => t.simulated),
    all_simulated: perTrap.length > 0 && perTrap.every((t) => t.simulated),
    per_trap: perTrap,
    assumptions: {
      calendar_spray_interval_days: cfg.calendarIntervalDays,
      spray_reapply_days: cfg.sprayReapplyDays,
      release_interval_days: cfg.releaseIntervalDays,
      area_per_trap_acres: cfg.areaPerTrapAcres,
      product_litres_per_acre_per_spray: cfg.productLitresPerAcrePerSpray,
      cost_per_acre_per_spray: cfg.costPerAcrePerSpray,
      placeholder: 'ESTIMATE - assumptions to confirm with the IIHR mentor and local farmers',
    },
  };
}
