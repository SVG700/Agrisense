/**
 * Economic Impact Engine: rupees saved (WAIT / BIOCONTROL) or at risk (SPRAY).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { economicsSettings, evaluateEconomics } from '../src/services/economics.js';
import { moneyLine } from '../src/services/telegram.js';
import { ADMIN_KEY, DEVICE, mockTrapUrl, startApp } from './helpers.js';

const T = { action_threshold_per_day: 25 };
const wait = { decision: 'WAIT', avg_pests: 12, avg_predators: 3, no_predators: false, thresholds: T };
const spray = { decision: 'SPRAY', avg_pests: 47, avg_predators: 0, no_predators: true, thresholds: T };

describe('economic impact', () => {
  test('WAIT with predators: spray cost + predators kept = saved today', () => {
    const e = evaluateEconomics(wait, economicsSettings({ acres: 1.6 }));
    assert.equal(e.kind, 'saved');
    assert.equal(e.headline, 'Chemical spray avoided');
    assert.equal(e.headline_inr, 2400 + 1920); // 1500/acre spray + 1200/acre predators, x 1.6 acres
    assert.deepEqual(e.lines.map((l) => l.id), ['spray', 'predators']);
    assert.equal(e.estimate, true);
  });

  test('WAIT without predators counts only the spray', () => {
    const e = evaluateEconomics({ ...wait, avg_predators: 0, no_predators: true }, economicsSettings({ acres: 1.6 }));
    assert.equal(e.headline_inr, 2400);
  });

  test('BIOCONTROL: saving is net of the release', () => {
    const e = evaluateEconomics({ decision: 'BIOCONTROL', avg_pests: 49, avg_predators: 12, no_predators: false, thresholds: T }, economicsSettings({ acres: 1 }));
    assert.equal(e.headline_inr, 1500 + 1200 - 900);
    assert.ok(e.lines.some((l) => l.id === 'release' && l.inr === -900));
  });

  test('SPRAY: yield value at risk scales with pest pressure and is set against the spray cost', () => {
    const s = economicsSettings({ crop: 'tomato', acres: 0.5 });
    const e = evaluateEconomics(spray, s);
    assert.equal(e.kind, 'at_risk');
    // 25,000 kg x Rs 20 x 0.5 acre = 2.5 lakh; 2% x 47/25 = 3.76% over 7 days
    assert.equal(e.headline_inr, 9400);
    assert.equal(e.spray_cost_inr, 750);
    assert.equal(e.net_benefit_inr, 8650);
    assert.equal(e.return_per_rupee, 12.5);
    // Higher pressure -> more at risk, capped at the weekly maximum
    const huge = evaluateEconomics({ ...spray, avg_pests: 1000 }, s);
    assert.equal(huge.loss_pct, 15);
  });

  test('farm settings override the presets; nonsense falls back', () => {
    const s = economicsSettings({ crop: 'capsicum', acres: '2', price: '50', yield: 'abc', spray_cost: '-4' });
    assert.equal(s.crop, 'capsicum');
    assert.equal(s.acres, 2);
    assert.equal(s.price_inr_per_kg, 50);
    assert.equal(s.yield_kg_per_acre, 18000); // preset
    assert.equal(s.spray_cost_inr_per_acre, 1500); // default
    assert.equal(economicsSettings({ crop: 'durian' }).crop, 'tomato');
  });

  test('CHECK TRAP / no data gives no estimate', () => {
    assert.equal(evaluateEconomics({ decision: 'CHECK_TRAP' }, economicsSettings()).kind, 'unknown');
    assert.equal(evaluateEconomics(null, economicsSettings()).headline_inr, null);
  });

  test('Telegram money line, both languages', () => {
    assert.match(moneyLine('en', wait), /Chemical spray avoided: <b>₹1,350 saved today<\/b>/);
    assert.match(moneyLine('en', spray), /₹9,400[\s\S]*7 days[\s\S]*₹750/);
    assert.match(moneyLine('kn', wait), /ಉಳಿತಾಯ/);
    assert.equal(moneyLine('en', { decision: 'CHECK_TRAP' }), null);
  });

  test('GET /api/economics uses the trap\'s live decision', async () => {
    const app = await startApp({ env: { ADMIN_API_KEY: ADMIN_KEY } });
    try {
      // A dense card -> SPRAY
      await app.request('POST', '/api/telemetry', { body: { temperature: 26, image_url: mockTrapUrl('econ', 0.9) }, headers: { 'X-Admin-Key': ADMIN_KEY } });
      const r = await app.request('GET', `/api/economics?device_id=${DEVICE}&crop=chilli&acres=1`);
      assert.equal(r.status, 200);
      assert.equal(r.body.decision, 'SPRAY');
      assert.equal(r.body.kind, 'at_risk');
      assert.equal(r.body.settings.crop, 'chilli');
      assert.ok(r.body.headline_inr > 0);
      assert.equal((await app.request('GET', '/api/economics?device_id=nope')).status, 400);
      const crops = (await app.request('GET', '/api/economics/crops')).body;
      assert.ok(crops.some((c) => c.id === 'tomato' && c.price_inr_per_kg > 0));
    } finally {
      await app.close();
    }
  });
});
