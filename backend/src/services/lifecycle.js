/**
 * Pest lifecycle forecast -> targeted treatment timing.
 *
 * Instead of "Can I spray now?", this follows the egg cohort laid when the trap
 * catch peaked through the hourly forecast and says WHEN to act:
 *
 *   development   hourly degree-days above the base temperature (upper cutoff),
 *                 nudged by humidity (moist air speeds development, dry air slows it)
 *   stages        egg -> crawler / 1st instar (unprotected, most vulnerable)
 *                 -> 2nd-3rd instar -> 4th instar / "pupa" -> adult  (degree-day bands)
 *   hatch trigger a forecast humidity spike close to the predicted hatch is taken
 *                 as the hatching cue (synchronised hatch)
 *   target        SPRAY      -> first safe spray hour while crawlers are exposed,
 *                               preferring the cool early morning
 *                 BIOCONTROL -> release when the cohort reaches the 3rd-4th instar
 *                               (the stages parasitoids such as Encarsia attack)
 *                 WAIT       -> scout / check the trap when the next adults emerge
 *
 * All stage bands, humidity effects and timing preferences are PLACEHOLDERS
 * (config/pests.json -> lifecycle) to confirm with the IIHR mentor.
 */
import { DEGREE_DAY_CONFIG, LIFECYCLE_CONFIG, SPRAY_CONFIG } from './pestConfig.js';
import { hourCheck } from './weather.js';

const HOUR = 3_600_000;
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Degree-days contributed by one hour, with the humidity nudge. */
export function hourlyDD(h, dd = DEGREE_DAY_CONFIG, lc = LIFECYCLE_CONFIG) {
  if (h.temp == null) return 0;
  const base = Math.max(0, Math.min(h.temp, dd.upperTempC) - dd.baseTempC) / 24;
  const rh = h.rh ?? 60;
  const f = rh >= lc.humidRh ? lc.humidFactor : rh <= lc.dryRh ? lc.dryFactor : 1;
  return base * f;
}

/** Forecast humidity spikes: RH rising >= risePts within 6 h, or crossing highRh from below lowRh within 12 h. */
export function humiditySpikes(hours, from, lc = LIFECYCLE_CONFIG) {
  const out = [];
  for (let i = Math.max(from, 6); i < hours.length; i++) {
    const rh = hours[i].rh;
    if (rh == null) continue;
    const before6 = hours[i - 6]?.rh;
    const min12 = Math.min(...hours.slice(Math.max(0, i - 12), i).map((h) => h.rh ?? 100));
    const rose = before6 != null && rh - before6 >= lc.spikeRisePts;
    const crossed = rh >= lc.spikeHighRh && min12 <= lc.spikeLowRh;
    if (rose || crossed) {
      const last = out.at(-1);
      if (last && hours[i].t - last.t < 12 * HOUR) {
        if (rh > last.rh_to) Object.assign(last, { t: hours[i].t, rh_to: rh });
        continue;
      }
      out.push({ t: hours[i].t, rh_from: Math.round(rose ? before6 : min12), rh_to: Math.round(rh) });
    }
  }
  return out;
}

/** Index of the first hour at/after time t. */
const indexAt = (hours, t) => {
  const i = hours.findIndex((h) => h.t + HOUR > t);
  return i < 0 ? hours.length : i;
};

/**
 * When the cohort reaches each degree-day mark (ms). Marks beyond the forecast are
 * projected at the last 7 days' average rate and listed in `projected`.
 */
function reachTimes(hours, startIdx, marks) {
  const times = {};
  const projected = new Set();
  let acc = 0;
  let m = 0;
  const sorted = [...marks].sort((a, b) => a - b);
  for (let i = startIdx; i < hours.length && m < sorted.length; i++) {
    acc += hourlyDD(hours[i]);
    while (m < sorted.length && acc >= sorted[m]) times[sorted[m++]] = hours[i].t;
  }
  if (m < sorted.length && hours.length) {
    const tail = hours.slice(-7 * 24);
    const perHour = tail.reduce((a, h) => a + hourlyDD(h), 0) / Math.max(1, tail.length);
    if (perHour > 0) {
      for (; m < sorted.length; m++) {
        times[sorted[m]] = hours.at(-1).t + ((sorted[m] - acc) / perHour) * HOUR;
        projected.add(sorted[m]);
      }
    }
  }
  return { times, projected, accumulated: acc };
}

/** Best treatment hour in [from, to): must pass the spray rules; prefers the early-morning band. */
function pickHour(hours, from, to, tz, lc = LIFECYCLE_CONFIG, needSprayRules = true) {
  const localHour = (t) => Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(t));
  let fallback = null;
  let skipped = null; // the first preferred morning that failed, and why
  for (let i = indexAt(hours, from); i < hours.length && hours[i].t < to; i++) {
    const check = needSprayRules ? hourCheck(hours, i, SPRAY_CONFIG) : { ok: hours[i].day && (hours[i].pop ?? 0) < SPRAY_CONFIG.maxRainProbability, checks: [] };
    const lh = localHour(hours[i].t);
    const preferred = lh >= lc.preferredStartHour && lh <= lc.preferredEndHour;
    if (!check.ok) {
      if (preferred && !skipped && lh === lc.preferredStartHour) {
        const why = (check.checks ?? []).filter((c) => !c.ok).map((c) => c.id);
        skipped = { t: hours[i].t, why: why.length ? why : ['rain'] };
      }
      continue;
    }
    if (preferred) return { i, check, preferred: true, skipped };
    fallback ??= { i, check, preferred: false, skipped };
  }
  return fallback;
}

/**
 * @param {{hours, timezone}} forecast   parsed Open-Meteo forecast (hourly, past + next 7 days)
 * @param {{decision?: object, days?: {date, pests}[], now?: number}} ctx
 */
export function predictLifecycle(forecast, { decision = null, days = [], now = Date.now() } = {}, lc = LIFECYCLE_CONFIG) {
  const { hours } = forecast;
  const tz = forecast.timezone || 'Asia/Kolkata';
  const fmt = (t, o) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...o }).format(t);
  const when = (t) => `${fmt(t, { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()} ${fmt(t, { weekday: 'long' })}`;
  const WHY = { rain: 'rain likely', wind: 'too windy', daylight: 'still dark' };
  const skippedNote = (p) =>
    p?.skipped && p.skipped.t < hours[p.i].t
      ? ` (${fmt(p.skipped.t, { weekday: 'long' })} morning is ruled out: ${p.skipped.why.map((w) => WHY[w] ?? w).join(', ')})`
      : '';
  const nowIdx = indexAt(hours, now);

  // 1. The cohort: eggs laid around the day the trap catch peaked (last 10 days), else today
  const recent = days.filter((d) => Date.parse(`${d.date}T12:00:00Z`) > now - 10 * 86_400_000);
  const peak = recent.reduce((m, d) => (!m || d.pests > m.pests ? d : m), null);
  const laidT = peak && peak.pests > 0 ? Date.parse(`${peak.date}T06:00:00Z`) : now;
  const laidIdx = Math.max(0, indexAt(hours, laidT));
  const S = lc.stages;
  const marks = [S.hatch, S.secondInstar, S.thirdInstar, S.adult];
  const { times, projected } = reachTimes(hours, laidIdx, marks);
  const ddSoFar = hours.slice(laidIdx, nowIdx).reduce((a, h) => a + hourlyDD(h), 0);

  const stageAt = (dd) => (dd < S.hatch ? 'egg' : dd < S.secondInstar ? 'crawler' : dd < S.thirdInstar ? 'young_nymph' : dd < S.adult ? 'late_nymph' : 'adult');
  let hatchT = times[S.hatch] ?? null;

  // 2. Humidity spike near the predicted hatch -> the hatching cue
  const spikes = humiditySpikes(hours, nowIdx);
  let spike = null;
  if (hatchT) {
    spike = spikes.find((s) => s.t >= hatchT - lc.spikeLeadHours * HOUR && s.t <= hatchT + lc.spikeLagHours * HOUR) ?? null;
    if (spike && spike.t > now) hatchT = spike.t;
  } else if (spikes.length && ddSoFar >= S.hatch * 0.75) {
    spike = spikes[0];
    hatchT = spike.t;
  }

  const crawlerEnd = times[S.secondInstar] ?? (hatchT ? hatchT + lc.crawlerFallbackHours * HOUR : null);
  const thirdT = times[S.thirdInstar] ?? null;
  const adultT = times[S.adult] ?? null;
  const stagesOut = [
    { id: 'egg', label: 'Eggs', start: new Date(laidT).toISOString(), end: hatchT ? new Date(hatchT).toISOString() : null, vulnerable: false },
    { id: 'crawler', label: 'Crawlers / 1st instar', start: hatchT ? new Date(hatchT).toISOString() : null, end: crawlerEnd ? new Date(crawlerEnd).toISOString() : null, vulnerable: true },
    { id: 'young_nymph', label: '2nd-3rd instar', start: crawlerEnd ? new Date(crawlerEnd).toISOString() : null, end: thirdT ? new Date(thirdT).toISOString() : null, vulnerable: false },
    { id: 'late_nymph', label: '3rd-4th instar / pupa', start: thirdT ? new Date(thirdT).toISOString() : null, end: adultT ? new Date(adultT).toISOString() : null, vulnerable: false },
    { id: 'adult', label: 'New adults', start: adultT ? new Date(adultT).toISOString() : null, end: null, vulnerable: false },
  ].map((st) => ({ ...st, projected: (st.id === 'adult' || st.id === 'late_nymph') && projected.has(S.adult) }));

  // 3. The action and its hour
  const d = decision?.decision ?? null;
  const horizonEnd = hours.at(-1)?.t ?? now;
  let target = null;
  let headline;
  const trigger = spike && hatchT === spike.t ? `Forecasted humidity spike (${spike.rh_from}% → ${spike.rh_to}%) indicates egg hatching.` : hatchT ? 'Heat build-up in the forecast indicates egg hatching.' : null;

  if (d === 'SPRAY') {
    const from = Math.max(now, hatchT ?? now);
    const to = crawlerEnd ?? horizonEnd;
    let pick = hatchT ? pickHour(hours, from, to, tz) : null;
    let stage = 'crawler';
    if (!pick) {
      // No safe hour while crawlers are exposed: next safe hour on young nymphs
      pick = pickHour(hours, from, thirdT ?? horizonEnd, tz);
      stage = 'young_nymph';
    }
    if (pick) {
      const t = hours[pick.i].t;
      target = { at: new Date(t).toISOString(), action: 'spray', stage, preferred_time: pick.preferred, conditions: pick.check.checks, temp: hours[pick.i].temp, rh: hours[pick.i].rh, wind_kmh: hours[pick.i].wind, rain_probability: hours[pick.i].pop };
      headline = `${trigger ?? 'Pest pressure is above the action level.'} Target vulnerable nymphs at ${when(t)}${skippedNote(pick)}.`;
      target.skipped = pick.skipped && pick.skipped.t < t ? { at: new Date(pick.skipped.t).toISOString(), why: pick.skipped.why } : null;
    } else {
      headline = `${trigger ?? 'Pest pressure is above the action level.'} No safe spray hour while nymphs are exposed in the next 7 days - watch the forecast.`;
    }
  } else if (d === 'BIOCONTROL') {
    const from = Math.max(now, thirdT ?? crawlerEnd ?? now);
    const pick = pickHour(hours, from, adultT ?? horizonEnd, tz, lc, false);
    if (pick) {
      const t = hours[pick.i].t;
      target = { at: new Date(t).toISOString(), action: 'release', stage: 'late_nymph', preferred_time: pick.preferred, temp: hours[pick.i].temp, rh: hours[pick.i].rh, wind_kmh: hours[pick.i].wind, rain_probability: hours[pick.i].pop, conditions: [] };
      headline = `${trigger ?? 'The cohort is developing.'} Release parasitoids when nymphs reach the 3rd-4th instar: ${when(t)}${skippedNote(pick)}.`;
    } else if (thirdT) {
      // Beyond the forecast: name the projected day (release in that morning)
      target = { at: new Date(thirdT).toISOString(), action: 'release', stage: 'late_nymph', projected: true, conditions: [] };
      headline = `${trigger ?? 'The cohort is developing.'} Release parasitoids on the morning of ${fmt(thirdT, { weekday: 'long', day: 'numeric', month: 'short' })}, when nymphs reach the 3rd-4th instar (projected past the 7-day forecast).`;
    } else {
      headline = `${trigger ?? 'The cohort is developing.'} Release parasitoids once nymphs reach the 3rd-4th instar.`;
    }
  } else if (d === 'WAIT') {
    const t = adultT && adultT > now ? adultT : null;
    if (t) target = { at: new Date(t).toISOString(), action: 'scout', stage: 'adult', conditions: [], projected: projected.has(S.adult) };
    headline = t
      ? `No treatment needed. The next whitefly generation emerges around ${fmt(t, { weekday: 'long', day: 'numeric', month: 'short' })}${projected.has(S.adult) ? ' (projected past the 7-day forecast)' : ''} - check the trap then.`
      : 'No treatment needed. Keep checking the trap every few days.';
  } else {
    headline = 'Check the trap first - the lifecycle forecast needs a readable, counted photo.';
  }

  return {
    available: true,
    placeholder: true,
    pest: DEGREE_DAY_CONFIG.pest,
    model: 'degree-days (hourly, upper cutoff) + humidity',
    timezone: tz,
    decision: d,
    headline,
    cohort: { laid_at: new Date(laidT).toISOString(), from: peak && peak.pests > 0 ? `peak catch on ${peak.date} (${round1(peak.pests)} pests)` : 'today (no clear peak)', degree_days_so_far: round1(ddSoFar) },
    stage_now: stageAt(ddSoFar),
    hatch_at: hatchT ? new Date(hatchT).toISOString() : null,
    humidity_spike: spike ? { at: new Date(spike.t).toISOString(), rh_from: spike.rh_from, rh_to: spike.rh_to } : null,
    stages: stagesOut,
    target,
    // Next 7 days of humidity + temperature for the chart (3-hourly to keep it light)
    forecast: hours
      .slice(nowIdx, nowIdx + 7 * 24)
      .filter((_, k) => k % 3 === 0)
      .map((h) => ({ t: new Date(h.t).toISOString(), temp: round1(h.temp), rh: h.rh, pop: h.pop })),
  };
}
