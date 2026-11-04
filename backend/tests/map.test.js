/**
 * Pest Surveillance Map: decision rule, /api/map-data, seed + location endpoints.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../src/db/memoryStore.js';
import { StoreError } from '../src/utils/validate.js';
import { aggregateDaily, decide, evaluateDecision, splitCounts, withTrapCheck } from '../src/services/decision.js';
import { ADMIN_KEY, DEVICE, mockTrapUrl, startApp } from './helpers.js';

const TRAP_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TRAP_B = 'aaaaaaaa-0000-4000-8000-000000000002';
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

const seedBody = () => ({
  traps: [
    { id: TRAP_A, name: 'SIM Malur 01', latitude: 13.0041, longitude: 77.9381 },
    { id: TRAP_B, name: 'SIM Kolar 02', latitude: 13.1367, longitude: 78.1292 },
  ],
  observations: [
    { trap_id: TRAP_A, date: daysAgo(1), pest_count: 55, predator_count: 2, dominant_pest: 'whitefly' }, // SPRAY
    { trap_id: TRAP_A, date: today, pest_count: 60, predator_count: 20, dominant_pest: 'whitefly' }, // BIOCONTROL (predators catching up)
    { trap_id: TRAP_B, date: today, pest_count: 4, predator_count: 0 }, // WAIT
  ],
});

describe('decision rule', () => {
  test('SPRAY / BIOCONTROL / WAIT thresholds (25/day, 10 pests per predator)', () => {
    assert.equal(decide(40, 0), 'SPRAY'); // no predators
    assert.equal(decide(40, 4), 'SPRAY'); // ratio 10 -> at the spray ratio
    assert.equal(decide(40, 5), 'BIOCONTROL'); // ratio 8 -> predators keeping pace
    assert.equal(decide(25, 0), 'SPRAY');
    assert.equal(decide(24, 0), 'WAIT');
    assert.equal(decide(-5, NaN), 'WAIT');
  });

  test('natural enemies are not counted as pests; model aliases are mapped', () => {
    assert.deepEqual(splitCounts({ whitefly: 9, aphid: 3, ladybird: 2, lacewing: 1 }), { pests: 12, predators: 3, dominant: 'whitefly' });
    assert.deepEqual(splitCounts({ WF: 30, MR: 2, NC: 1 }), { pests: 30, predators: 3, dominant: 'whitefly' });
    assert.equal(splitCounts({ mystery_bug: 5 }).pests, 5); // unknown classes count as pests (conservative)
  });

  test('evaluateDecision averages the last 3 days and explains itself', () => {
    const days = [
      { date: '2026-10-01', pests: 200, predators: 0 }, // outside the window
      { date: '2026-10-02', pests: 30, predators: 1 },
      { date: '2026-10-03', pests: 36, predators: 2 },
      { date: '2026-10-04', pests: 24, predators: 3 },
    ];
    const r = evaluateDecision(days);
    assert.equal(r.avg_pests, 30);
    assert.equal(r.avg_predators, 2);
    assert.equal(r.decision, 'SPRAY'); // 30/day, 15 per predator
    assert.equal(r.label, 'SPRAY');
    assert.deepEqual(r.window, { days: 3, requested: 3, from: '2026-10-02', to: '2026-10-04' });
    assert.match(r.reason, /30 pests\/day over the last 3 days/);
    assert.equal(r.thresholds.placeholder, 'to confirm with IIHR mentor');
    assert.deepEqual(r.range.pests, [25.5, 34.5]); // ±15% when confidence is unknown
  });

  test('evaluateDecision: biocontrol, borderline, no data, partial window', () => {
    const bio = evaluateDecision([{ date: '2026-10-01', pests: 60, predators: 20, confidence: 0.9 }]);
    assert.equal(bio.decision, 'BIOCONTROL');
    assert.equal(bio.label, 'RELEASE BIOCONTROL');
    assert.equal(bio.borderline, false);
    assert.match(bio.reason, /only 1 of 3 days/);

    const edge = evaluateDecision([{ date: '2026-10-01', pests: 26, predators: 0 }]);
    assert.equal(edge.decision, 'SPRAY');
    assert.equal(edge.borderline, true);
    assert.ok(edge.possible_decisions.includes('WAIT'));
    assert.match(edge.reason, /BORDERLINE/);

    // Low detector confidence widens the range (capped at 50%)
    assert.equal(evaluateDecision([{ date: 'd', pests: 40, predators: 0, confidence: 0.2 }]).range.uncertainty, 0.5);

    const none = evaluateDecision([]);
    assert.equal(none.decision, null);
    assert.equal(none.label, 'NO DATA');
  });

  test('CHECK TRAP: uncounted latest photo or a quiet trap overrides the count decision', () => {
    const counted = evaluateDecision([{ date: '2026-10-01', pests: 40, predators: 0 }]);
    const now = Date.parse('2026-10-02T12:00:00Z');
    const fresh = { status: 'ok', timestamp: '2026-10-02T08:00:00Z' };
    assert.equal(withTrapCheck(counted, fresh, { now }).decision, 'SPRAY');
    assert.equal(withTrapCheck(counted, null, { now }).decision, 'SPRAY');

    const failed = withTrapCheck(counted, { status: 'failed', timestamp: '2026-10-02T08:00:00Z' }, { now });
    assert.equal(failed.decision, 'CHECK_TRAP');
    assert.equal(failed.label, 'CHECK TRAP');
    assert.match(failed.reason, /could not be analysed/);
    assert.equal(failed.last_counted.decision, 'SPRAY');

    const quiet = withTrapCheck(counted, { status: 'ok', timestamp: '2026-09-29T08:00:00Z' }, { now });
    assert.equal(quiet.decision, 'CHECK_TRAP');
    assert.match(quiet.reason, /No capture for 76 hours/);
  });

  test('daily aggregation keeps the max capture per trap/day and skips unlocated traps', () => {
    const devices = new Map([
      [TRAP_A, { id: TRAP_A, name: 'A', latitude: 13, longitude: 77 }],
      [TRAP_B, { id: TRAP_B, name: 'B', latitude: null, longitude: null }],
    ]);
    const cap = (device_id, ts, counts, status = 'ok') => ({
      device_id,
      timestamp: ts,
      detection: { pest_counts: counts, vision_meta: { status } },
    });
    const rows = aggregateDaily(
      [
        cap(TRAP_A, '2026-10-01T08:00:00Z', { whitefly: 10 }),
        cap(TRAP_A, '2026-10-01T16:00:00Z', { whitefly: 25, spider: 4 }),
        cap(TRAP_A, '2026-10-02T08:00:00Z', { whitefly: 99 }, 'failed'), // not counted
        cap(TRAP_B, '2026-10-01T08:00:00Z', { whitefly: 50 }), // no coordinates
      ],
      devices
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].pest_count, 25);
    assert.equal(rows[0].predator_count, 4);
  });
});

describe('GET /api/map-data + seed', () => {
  const env = { ADMIN_API_KEY: ADMIN_KEY };
  const admin = { 'X-Admin-Key': ADMIN_KEY };

  test('seed requires admin; loads simulated traps; decisions computed server-side', async () => {
    const app = await startApp({ env });
    try {
      assert.equal((await app.request('POST', '/api/admin/map-seed', { body: seedBody() })).status, 401);
      const body = seedBody();
      body.observations[0].decision = 'WAIT'; // a client-sent decision must be ignored
      const seeded = await app.request('POST', '/api/admin/map-seed', { body, headers: admin });
      assert.equal(seeded.status, 201);
      assert.deepEqual(seeded.body.decisions, { SPRAY: 1, BIOCONTROL: 1, WAIT: 1 });

      const map = await app.request('GET', '/api/map-data?days=7');
      assert.equal(map.status, 200);
      const { rows, meta } = map.body;
      assert.equal(rows.length, 3);
      assert.deepEqual(Object.keys(rows[0]).sort(), [
        'borderline', 'date', 'decision', 'decision_reason', 'dominant_pest', 'latitude', 'longitude', 'pest_count', 'predator_count', 'simulated', 'source', 'trap_id', 'trap_name',
      ]);
      assert.equal(rows[0].decision, 'SPRAY');
      // Today's TRAP_A decision averages yesterday (55,2) and today (60,20): 57.5/day, ~5 per predator
      const aToday = rows.find((r) => r.trap_id === TRAP_A && r.date === today);
      assert.equal(aToday.decision, 'BIOCONTROL');
      assert.match(aToday.decision_reason, /last 2 days/);

      const dec = await app.request('GET', `/api/decision?device_id=${TRAP_A}`);
      assert.equal(dec.status, 200);
      assert.equal(dec.body.decision, 'BIOCONTROL');
      assert.equal(dec.body.avg_pests, 57.5);
      assert.equal(dec.body.simulated, true);
      assert.equal(dec.body.days.length, 2);
      assert.equal((await app.request('GET', '/api/decision?device_id=nope')).status, 400);
      assert.ok(rows.every((r) => r.simulated === true));
      assert.equal(meta.simulated, true);
      assert.equal(meta.all_simulated, true);
      assert.equal(meta.trap_count, 2);

      // Re-seeding is idempotent (upsert by trap + day)
      await app.request('POST', '/api/admin/map-seed', { body: seedBody(), headers: admin });
      assert.equal((await app.request('GET', '/api/map-data?days=7')).body.rows.length, 3);

      // Simulated map traps stay out of the dashboard's device list
      const devices = (await app.request('GET', '/api/devices')).body;
      assert.ok(!devices.some((d) => d.id === TRAP_A));
    } finally {
      await app.close();
    }
  });

  test('seed validation: bad coordinates, unknown trap, future date, real-device clash', async () => {
    const app = await startApp({ env });
    try {
      const post = (body) => app.request('POST', '/api/admin/map-seed', { body, headers: admin });
      const b1 = seedBody();
      b1.traps[0].latitude = 123;
      assert.equal((await post(b1)).body.code, 'invalid_coordinates');
      const b2 = seedBody();
      b2.observations[0].trap_id = DEVICE;
      assert.equal((await post(b2)).body.code, 'unknown_trap');
      const b3 = seedBody();
      b3.observations[0].date = '2999-01-01';
      assert.equal((await post(b3)).body.code, 'invalid_date');
      const b4 = seedBody();
      b4.observations[0].pest_count = 3.5;
      assert.equal((await post(b4)).body.code, 'invalid_count');
      const b5 = seedBody();
      b5.traps[0].id = DEVICE; // the real demo device
      b5.observations = [];
      assert.equal((await post(b5)).status, 409);
    } finally {
      await app.close();
    }
  });

  test('real captures appear once the trap has coordinates', async () => {
    const app = await startApp({ env });
    try {
      await app.request('POST', '/api/telemetry', { body: { temperature: 26, humidity: 70, image_url: mockTrapUrl('m1', 0.9) } });
      assert.equal((await app.request('GET', '/api/map-data')).body.rows.length, 0);
      assert.match((await app.request('GET', '/api/map-data')).body.meta.warnings.join(' '), /no coordinates/);

      assert.equal((await app.request('PATCH', '/api/device/location', { body: { device_id: DEVICE, latitude: 13.2, longitude: 77.7 } })).status, 401);
      const loc = await app.request('PATCH', '/api/device/location', {
        body: { device_id: DEVICE, latitude: 13.2, longitude: 77.7 },
        headers: admin,
      });
      assert.equal(loc.status, 200);

      const { rows } = (await app.request('GET', '/api/map-data')).body;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].source, 'captures');
      assert.equal(rows[0].simulated, true); // synthetic demo trap image
      assert.ok(['SPRAY', 'BIOCONTROL', 'WAIT'].includes(rows[0].decision));
    } finally {
      await app.close();
    }
  });

  test('database without the v3 table still returns real data plus a warning', async () => {
    const store = createMemoryStore();
    store.listObservations = async () => {
      throw new StoreError('listObservations', new Error('relation does not exist'));
    };
    const app = await startApp({ store });
    try {
      const res = await app.request('GET', '/api/map-data');
      assert.equal(res.status, 200);
      assert.match(res.body.meta.warnings.join(' '), /schema\.sql/);
    } finally {
      await app.close();
    }
  });

  test('DELETE /api/admin/map-seed removes only simulated traps', async () => {
    const app = await startApp({ env });
    try {
      await app.request('POST', '/api/admin/map-seed', { body: seedBody(), headers: admin });
      const del = await app.request('DELETE', '/api/admin/map-seed', { headers: admin });
      assert.equal(del.body.removed_traps, 2);
      assert.equal((await app.request('GET', '/api/map-data')).body.rows.length, 0);
      assert.ok((await app.request('GET', '/api/devices')).body.some((d) => d.id === DEVICE));
    } finally {
      await app.close();
    }
  });
});

describe('what-if simulator', () => {
  test('simulate uses the same engine: decision, reason, range, borderline', async () => {
    const app = await startApp({});
    try {
      const spray = await app.request('GET', '/api/decision/simulate?pests=40&predators=2');
      assert.equal(spray.status, 200);
      assert.equal(spray.body.decision, 'SPRAY');
      assert.equal(spray.body.avg_pests, 40);
      assert.equal(spray.body.window.days, 3);
      assert.deepEqual(spray.body.inputs, { pests_per_day: 40, predators_per_day: 2, confidence: null });
      assert.deepEqual(spray.body, { ...evaluateDecision([1, 2, 3].map((i) => ({ date: `d${i}`, pests: 40, predators: 2 }))), inputs: spray.body.inputs, window: spray.body.window });

      const bio = await app.request('GET', '/api/decision/simulate?pests=40&predators=8');
      assert.equal(bio.body.label, 'RELEASE BIOCONTROL');
      // Lower detector confidence widens the range -> borderline near the threshold
      assert.equal((await app.request('GET', '/api/decision/simulate?pests=23&predators=0&confidence=0.95')).body.borderline, false);
      assert.equal((await app.request('GET', '/api/decision/simulate?pests=23&predators=0&confidence=0.7')).body.borderline, true);

      assert.equal((await app.request('GET', '/api/decision/simulate?pests=-1&predators=0')).status, 400);
      assert.equal((await app.request('GET', '/api/decision/simulate?predators=0')).status, 400);
      assert.equal((await app.request('GET', '/api/decision/simulate?pests=5&predators=0&confidence=2')).status, 400);
    } finally {
      await app.close();
    }
  });

  test('regions: a grid of decisions from decide() with the configured thresholds', async () => {
    const app = await startApp({});
    try {
      const r = (await app.request('GET', '/api/decision/regions?max_pests=100&max_predators=20&steps=20')).body;
      assert.equal(r.pests.length, 21);
      assert.equal(r.cells.length, 21);
      const at = (p, q) => r.cells[r.predators.indexOf(q)][r.pests.indexOf(p)];
      assert.equal(at(20, 0), 'WAIT');
      assert.equal(at(25, 0), 'SPRAY');
      assert.equal(at(50, 5), 'SPRAY'); // 10 per predator
      assert.equal(at(50, 6), 'BIOCONTROL');
      assert.equal(r.thresholds.action_threshold_per_day, 25);
    } finally {
      await app.close();
    }
  });
});

describe('decision cache', () => {
  test('repeat requests are cached; a new capture refreshes that trap at once', async () => {
    const app = await startApp({});
    try {
      await app.request('POST', '/api/telemetry', { body: { temperature: 25, image_url: mockTrapUrl('c1', 0.05) } });
      let reads = 0;
      const original = app.store.listTelemetry.bind(app.store);
      app.store.listTelemetry = (...a) => (reads++, original(...a));
      const first = await app.request('GET', `/api/decision?device_id=${DEVICE}`);
      await app.request('GET', `/api/decision?device_id=${DEVICE}`);
      assert.equal(reads, 1); // second answer came from the cache
      assert.equal(first.body.decision, 'WAIT');

      // A dense card arrives -> the next decision is recomputed, not stale
      await app.request('POST', '/api/telemetry', { body: { temperature: 25, image_url: mockTrapUrl('c2', 1.6) } });
      const after = await app.request('GET', `/api/decision?device_id=${DEVICE}`);
      assert.notEqual(after.body.avg_pests, first.body.avg_pests);
    } finally {
      await app.close();
    }
  });
});
