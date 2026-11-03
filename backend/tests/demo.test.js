/**
 * Demo mode: one-click reset seeds 4 DEMO traps whose decisions cover every
 * traffic-light state, all clearly labelled as simulated.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_TRAPS, _internals } from '../src/services/demoData.js';
import { generateTrap, parseMockTrapUrl } from '../src/services/mockTrap.js';
import { ADMIN_KEY, startApp } from './helpers.js';

const admin = { 'X-Admin-Key': ADMIN_KEY };
const env = { ADMIN_API_KEY: ADMIN_KEY };

describe('demo mode', () => {
  test('mock traps can include predators; old seeds render exactly as before', () => {
    assert.deepEqual(generateTrap('x', 0.5), generateTrap('x', 0.5, {})); // default path unchanged
    const labels = generateTrap('x', 1.2, { mix: 'wf', predators: 0.2 }).map((b) => b.label);
    assert.ok(labels.includes('macrolophus') || labels.includes('nesidiocoris'));
    assert.ok(labels.filter((l) => l === 'whitefly').length > labels.length / 2);
    assert.deepEqual(parseMockTrapUrl('http://h/api/mock-trap/a.svg?d=0.5&m=wf&p=0.1').opts, { mix: 'wf', predators: 0.1 });
  });

  test('14 days of captures, twice a day, never in the future', () => {
    const now = Date.parse('2026-11-03T06:00:00Z');
    const plan = _internals.planCaptures(DEMO_TRAPS[0], now);
    assert.equal(plan[0].timestamp, '2026-10-21T02:30:00.000Z');
    assert.equal(plan.at(-1).timestamp, '2026-11-03T02:30:00.000Z'); // today's 17:00 IST slot not reached yet
    assert.equal(plan.length, 27);
    assert.ok(plan.every((p) => Date.parse(p.timestamp) <= now));
  });

  test('reset needs admin, seeds every traffic-light state, is repeatable, and can be cleared', async () => {
    const app = await startApp({ env });
    try {
      assert.equal((await app.request('POST', '/api/admin/demo/reset')).status, 401);

      const res = await app.request('POST', '/api/admin/demo/reset', { headers: admin });
      assert.equal(res.status, 201);
      const byName = Object.fromEntries(res.body.traps.map((t) => [t.name, t]));
      assert.equal(byName['DEMO · Polyhouse 1 (tomato)'].decision, 'SPRAY');
      assert.equal(byName['DEMO · Polyhouse 2 (tomato)'].decision, 'BIOCONTROL');
      assert.equal(byName['DEMO · Net-house (capsicum)'].decision, 'WAIT');
      assert.equal(byName['DEMO · Net-house (capsicum)'].borderline, true);
      assert.equal(byName['DEMO · Polyhouse 3 (cucumber)'].decision, 'CHECK_TRAP');

      // Demo traps appear on the dashboard and every capture is labelled simulated
      const devices = (await app.request('GET', '/api/devices')).body;
      assert.equal(devices.filter((d) => d.name.startsWith('DEMO ·')).length, 4);
      const trap2 = DEMO_TRAPS[1].id;
      const rows = (await app.request('GET', `/api/telemetry?device_id=${trap2}&limit=100`)).body;
      assert.equal(rows.length, res.body.traps[1].captures);
      for (const t of rows) {
        assert.equal(t.data_source, 'simulator');
        assert.equal(t.detection.vision_meta.provider, 'demo-detector');
        assert.equal(t.detection.ai_advisory.status, 'demo');
      }
      assert.ok(rows.at(-1).detection.pest_counts.macrolophus > 0);

      // The decision API agrees with the seeded result
      assert.equal((await app.request('GET', `/api/decision?device_id=${trap2}`)).body.decision, 'BIOCONTROL');

      // Reset again: same traps, no duplicates
      const again = await app.request('POST', '/api/admin/demo/reset', { headers: admin });
      assert.equal(again.body.captures, res.body.captures);
      assert.equal((await app.request('GET', `/api/telemetry?device_id=${trap2}&limit=500`)).body.length, rows.length);

      assert.equal((await app.request('DELETE', '/api/admin/demo', { headers: admin })).body.removed, 4);
      assert.equal((await app.request('GET', '/api/devices')).body.filter((d) => d.name.startsWith('DEMO ·')).length, 0);
    } finally {
      await app.close();
    }
  });
});
