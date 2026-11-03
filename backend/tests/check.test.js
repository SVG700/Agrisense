/**
 * Phone check: photo + days the card hung -> counts, per-day rate, decision,
 * advisory and annotated image. Nothing is stored.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderTrapSvg } from '../src/services/mockTrap.js';
import { fakeHttp, startApp } from './helpers.js';

let card;
let blurry;
before(async () => {
  card = await sharp(Buffer.from(renderTrapSvg('phone', 0.9, { mix: 'wf' })), { density: 108 }).resize(1200, 900).jpeg().toBuffer();
  blurry = await sharp(card).blur(6).jpeg().toBuffer();
});

/** Fake Roboflow returning `wf` whiteflies and `mr` Macrolophus. */
const roboflow = (wf, mr) =>
  fakeHttp(() => ({
    image: { width: 1200, height: 900 },
    predictions: [
      ...Array.from({ length: wf }, (_, i) => ({ class: 'WF', confidence: 0.9, x: 20 + (i % 40) * 28, y: 30 + Math.floor(i / 40) * 40, width: 12, height: 10 })),
      ...Array.from({ length: mr }, (_, i) => ({ class: 'MR', confidence: 0.85, x: 600 + i * 40, y: 800, width: 24, height: 9 })),
    ],
  }));

const env = { ROBOFLOW_API_KEY: 'rk', VISION_QUALITY_CHECK: 'true' };

describe('POST /api/check', () => {
  test('counts per day decide the advice; nothing is stored', async () => {
    // 210 whiteflies + 3 predators over 7 days = 30/day, 70 per predator -> SPRAY
    const app = await startApp({ env, visionHttp: roboflow(210, 3) });
    try {
      const res = await app.request('POST', '/api/check', { body: { image_base64: card.toString('base64'), days_hung: 7 } });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.counts, { whitefly: 210, macrolophus: 3, nesidiocoris: 0 });
      assert.deepEqual(res.body.per_day, { pests: 30, predators: 0.4 });
      assert.equal(res.body.decision.decision, 'SPRAY');
      assert.match(res.body.decision.reason, /over the 7 days the card hung/);
      assert.equal(res.body.advisory.decision, undefined); // advisory explains, decision sits beside it
      assert.ok(res.body.advisory.recommendation);
      assert.match(res.body.annotated_image, /^data:image\/jpeg/);
      assert.equal(res.body.quality.ok, true);
      assert.equal(res.body.stored, false);
      assert.equal((await app.request('GET', '/api/telemetry')).body.length, 0);
    } finally {
      await app.close();
    }
  });

  test('same card, more days hung -> lower daily rate -> WAIT; short hang is flagged', async () => {
    const app = await startApp({ env, visionHttp: roboflow(60, 0) });
    try {
      const long = await app.request('POST', '/api/check', { body: { image_base64: card.toString('base64'), days_hung: 6 } });
      assert.equal(long.body.decision.decision, 'WAIT'); // 10/day
      const short = await app.request('POST', '/api/check', { body: { image_base64: card.toString('base64'), days_hung: 1 } });
      assert.equal(short.body.decision.decision, 'SPRAY'); // 60/day
      assert.match(short.body.decision.reason, /hung only 1 day/);
    } finally {
      await app.close();
    }
  });

  test('predators keeping pace -> RELEASE BIOCONTROL', async () => {
    const app = await startApp({ env, visionHttp: roboflow(120, 30) });
    try {
      const res = await app.request('POST', '/api/check', { body: { image_base64: card.toString('base64'), days_hung: 3 } });
      assert.equal(res.body.decision.label, 'RELEASE BIOCONTROL'); // 40/day, 4 per predator
    } finally {
      await app.close();
    }
  });

  test('a blurry photo -> CHECK TRAP with retake advice, no model call', async () => {
    const http = roboflow(100, 0);
    const app = await startApp({ env, visionHttp: http });
    try {
      const res = await app.request('POST', '/api/check', { body: { image_base64: blurry.toString('base64'), days_hung: 5 } });
      assert.equal(res.status, 200);
      assert.equal(res.body.decision.decision, 'CHECK_TRAP');
      assert.match(res.body.decision.reason, /too blurry/);
      assert.equal(res.body.counts, null);
      assert.equal(res.body.advisory, null);
      assert.equal(http.calls.length, 0);
    } finally {
      await app.close();
    }
  });

  test('validation: photo required, days_hung 1-30', async () => {
    const app = await startApp({ env, visionHttp: roboflow(1, 0) });
    try {
      assert.equal((await app.request('POST', '/api/check', { body: { days_hung: 3 } })).body.code, 'missing_image');
      for (const d of [0, 31, 2.5, '3', undefined]) {
        const r = await app.request('POST', '/api/check', { body: { image_base64: card.toString('base64'), days_hung: d } });
        assert.equal(r.status, 422, String(d));
      }
    } finally {
      await app.close();
    }
  });
});
