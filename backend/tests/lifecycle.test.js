/**
 * Lifecycle forecast -> targeted timing (synthetic hourly forecasts, IST).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hourlyDD, humiditySpikes, predictLifecycle } from '../src/services/lifecycle.js';

const H = 3_600_000;
// Monday 2 Nov 2026, 00:00 IST
const T0 = Date.parse('2026-11-01T18:30:00Z');

/** 21 days of hours from 14 days before T0: warm days (30 °C), mild nights, calm, dry. */
function forecast({ rh = () => 60, pop = () => 0, wind = () => 5 } = {}) {
  const hours = [];
  for (let k = -14 * 24; k < 7 * 24; k++) {
    const t = T0 + k * H;
    const localHour = ((k % 24) + 24) % 24;
    hours.push({ t, temp: localHour >= 9 && localHour <= 17 ? 30 : 20, rh: rh(k, localHour), pop: pop(k, localHour), rain: 0, wind: wind(k, localHour), gust: 8, day: localHour >= 6 && localHour <= 18 });
  }
  return { hours, timezone: 'Asia/Kolkata' };
}
const days = (peakDaysAgo, pests = 60) => [{ date: new Date(T0 - peakDaysAgo * 86_400_000 + 12 * H).toISOString().slice(0, 10), pests }];
const ist = (iso, o) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...o }).format(new Date(iso));
const SPRAY = { decision: 'SPRAY' };

describe('pest lifecycle', () => {
  test('degree-days per hour: base 10 °C, upper cutoff, humidity nudge', () => {
    assert.equal(hourlyDD({ temp: 34, rh: 60 }), (32 - 10) / 24);
    assert.equal(hourlyDD({ temp: 8, rh: 60 }), 0);
    assert.ok(hourlyDD({ temp: 25, rh: 85 }) > hourlyDD({ temp: 25, rh: 60 }));
    assert.ok(hourlyDD({ temp: 25, rh: 30 }) < hourlyDD({ temp: 25, rh: 60 }));
  });

  test('a humidity spike is found where RH jumps', () => {
    const f = forecast({ rh: (k) => (k >= 40 && k < 46 ? 90 : 55) });
    const spikes = humiditySpikes(f.hours, 14 * 24);
    assert.equal(spikes.length, 1);
    assert.equal(spikes[0].rh_to, 90);
  });

  test('SPRAY: a humidity spike near the predicted hatch sets the hatch; target is the next safe 06:00', () => {
    // Eggs from 4 days ago reach ~90 DD around now+1-2 days; a spike on day 2 evening
    const f = forecast({ rh: (k) => (k >= 2 * 24 + 18 && k < 2 * 24 + 22 ? 92 : 55) });
    const out = predictLifecycle(f, { decision: SPRAY, days: days(4), now: T0 });
    assert.ok(out.humidity_spike, 'spike used as the hatch cue');
    assert.equal(out.hatch_at, out.humidity_spike.at);
    assert.equal(out.target.action, 'spray');
    assert.equal(out.target.stage, 'crawler');
    assert.equal(out.target.preferred_time, true);
    assert.equal(ist(out.target.at, { hour: '2-digit', hour12: false }), '06');
    assert.ok(Date.parse(out.target.at) > Date.parse(out.hatch_at));
    assert.match(out.headline, /Forecasted humidity spike \(55% → 92%\) indicates egg hatching\. Target vulnerable nymphs at 06:00 AM \w+day/);
  });

  test('a rainy morning is skipped and said so', () => {
    const f0 = forecast({ rh: (k) => (k >= 2 * 24 + 18 && k < 2 * 24 + 22 ? 92 : 55) });
    const first = predictLifecycle(f0, { decision: SPRAY, days: days(4), now: T0 }).target.at;
    const firstK = Math.round((Date.parse(first) - T0) / H);
    // Rain over that morning
    const f = forecast({ rh: (k) => (k >= 2 * 24 + 18 && k < 2 * 24 + 22 ? 92 : 55), pop: (k) => (k >= firstK - 2 && k <= firstK + 4 ? 90 : 0) });
    const out = predictLifecycle(f, { decision: SPRAY, days: days(4), now: T0 });
    assert.ok(Date.parse(out.target.at) > Date.parse(first));
    assert.match(out.headline, /morning is ruled out: rain likely/);
    assert.ok(out.target.skipped);
  });

  test('BIOCONTROL targets the 3rd-4th instar, later than the spray target', () => {
    const f = forecast();
    const spray = predictLifecycle(f, { decision: SPRAY, days: days(4), now: T0 });
    const bio = predictLifecycle(f, { decision: { decision: 'BIOCONTROL' }, days: days(4), now: T0 });
    assert.equal(bio.target.action, 'release');
    assert.ok(Date.parse(bio.target.at) > Date.parse(spray.target.at));
    assert.match(bio.headline, /Release parasitoids/);
  });

  test('WAIT: says when the next adults emerge (projected past the forecast if needed)', () => {
    const out = predictLifecycle(forecast(), { decision: { decision: 'WAIT' }, days: days(1), now: T0 });
    assert.equal(out.target.action, 'scout');
    assert.match(out.headline, /No treatment needed\. The next whitefly generation emerges around/);
    assert.ok(Date.parse(out.target.at) > T0);
  });

  test('CHECK TRAP gives no timing; stages are always listed in order', () => {
    const out = predictLifecycle(forecast(), { decision: { decision: 'CHECK_TRAP' }, days: days(4), now: T0 });
    assert.equal(out.target, null);
    assert.deepEqual(out.stages.map((s) => s.id), ['egg', 'crawler', 'young_nymph', 'late_nymph', 'adult']);
    assert.equal(out.stages.find((s) => s.vulnerable).id, 'crawler');
    assert.equal(out.placeholder, true);
  });
});
