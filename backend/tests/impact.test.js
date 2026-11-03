/**
 * Impact ESTIMATE vs calendar spraying.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estimateImpact } from '../src/services/impact.js';
import { ADMIN_KEY, startApp } from './helpers.js';

/** 14 days for one trap; `pick(dayIndex)` gives the decision. */
const trap = (id, pick, simulated = false) =>
  Array.from({ length: 14 }, (_, i) => ({
    trap_id: id,
    trap_name: `Trap ${id}`,
    date: `2026-10-${String(i + 1).padStart(2, '0')}`,
    decision: pick(i),
    simulated,
  }));

describe('estimateImpact', () => {
  test('hand-checked: calendar 6 sprays, AgriSense 2 -> 4 avoided (67%)', () => {
    const rows = [
      ...trap('A', (i) => (i < 4 ? 'WAIT' : 'SPRAY')), // sprays on day 5 and day 12 = 2 (calendar 2)
      ...trap('B', () => 'WAIT'), // 0 (calendar 2)
      ...trap('C', (i) => (i < 5 ? 'WAIT' : 'BIOCONTROL')), // 0 sprays, releases day 6 + 13 (calendar 2)
    ];
    const r = estimateImpact(rows);
    assert.equal(r.estimate, true);
    assert.equal(r.calendar_sprays, 6);
    assert.equal(r.agrisense_sprays, 2);
    assert.equal(r.biocontrol_releases, 2);
    assert.equal(r.sprays_avoided, 4);
    assert.equal(r.percent_fewer_sprays, 67);
    assert.equal(r.product_litres_saved, 0.5); // 4 sprays x 0.5 acre x 0.25 L
    assert.equal(r.cost_saved, 3000); // 4 x 0.5 acre x Rs 1500
    assert.equal(r.predator_protected_days, 9);
    assert.equal(r.per_trap.find((t) => t.trap_id === 'A').sprays_avoided, 0);
    assert.match(r.assumptions.placeholder, /ESTIMATE/);
  });

  test('a trap spraying more than the calendar never counts as negative savings', () => {
    // SPRAY every day with a 1-day reapply would be 14 sprays vs calendar 2
    const r = estimateImpact(trap('X', () => 'SPRAY'), { calendarIntervalDays: 7, sprayReapplyDays: 1, releaseIntervalDays: 7, areaPerTrapAcres: 1, productLitresPerAcrePerSpray: 1, costPerAcrePerSpray: 1, currency: 'INR' });
    assert.equal(r.agrisense_sprays, 14);
    assert.equal(r.sprays_avoided, 0);
  });

  test('no data -> zeros, not NaN', () => {
    const r = estimateImpact([]);
    assert.equal(r.traps, 0);
    assert.equal(r.percent_fewer_sprays, 0);
    assert.equal(r.all_simulated, false);
  });
});

describe('GET /api/impact', () => {
  test('covers every trap (also without coordinates) and labels simulated data', async () => {
    const app = await startApp({ env: { ADMIN_API_KEY: ADMIN_KEY } });
    try {
      await app.request('POST', '/api/admin/demo/reset', { headers: { 'X-Admin-Key': ADMIN_KEY } });
      // A trap without coordinates still counts
      await app.request('POST', '/api/telemetry', { body: { temperature: 25, image_url: 'http://localhost:4000/api/mock-trap/i1.svg?d=0.2' } });
      const r = (await app.request('GET', '/api/impact?days=30')).body;
      assert.equal(r.estimate, true);
      assert.equal(r.days, 30);
      assert.equal(r.traps, 5);
      assert.ok(r.calendar_sprays >= r.sprays_avoided);
      assert.ok(r.sprays_avoided > 0);
      assert.equal(r.simulated, true);
      assert.ok(r.biocontrol_releases >= 1); // Polyhouse 2 releases instead of spraying
      assert.equal(r.per_trap.find((t) => t.trap_name.includes('Net-house')).agrisense_sprays, 0);
    } finally {
      await app.close();
    }
  });
});
