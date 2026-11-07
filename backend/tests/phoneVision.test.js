/**
 * Phone photos -> the AgroPest-12 inference service (PHONE_VISION_URL), while trap
 * captures keep the main (Roboflow) model. The service itself is faked here; it has
 * its own tests in inference-service/test_service.py.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { splitCounts } from '../src/services/decision.js';
import { fakeHttp, startApp } from './helpers.js';

let photo;
before(async () => {
  // A 3000 x 2000 "phone photo" (the service must receive a downscaled, upright copy)
  photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 90, g: 140, b: 60 } } }).jpeg().toBuffer();
});

/** Fake inference service: answers in the generic contract with pixel boxes of the image it received. */
const agropest = (detections) =>
  fakeHttp(async ({ body }) => {
    const meta = await sharp(Buffer.from(body.image_base64, 'base64')).metadata();
    return { detections: detections(meta), image_width: meta.width, image_height: meta.height, model: 'agropest12-yolov8s' };
  });

const env = { ROBOFLOW_API_KEY: 'rk', PHONE_VISION_URL: 'http://127.0.0.1:8800/detect', PHONE_VISION_API_KEY: 'inference-key-123' };
const box = (label, confidence, i) => ({ label, confidence, bbox: [10 + i * 30, 10, 30 + i * 30, 40] });

describe('Phone check with the AgroPest-12 model', () => {
  test('phone photos go to the inference service, with real class names and categories', async () => {
    const trap = fakeHttp(() => { throw new Error('the trap model must not be called for a phone photo'); });
    const phone = agropest(() => [
      ...Array.from({ length: 14 }, (_, i) => box('Weevils', 0.9, i)),
      box('Caterpillars', 0.8, 15),
      box('Bees', 0.95, 16), // beneficial: shown, never counted as a pest
      box('Wasps', 0.7, 17), // natural enemy: counted as a predator
      box('Moths', 0.1, 18), // below PHONE_VISION_MIN_CONFIDENCE: drawn, not counted
    ]);
    const app = await startApp({ env, visionHttp: trap, phoneVisionHttp: phone });
    try {
      const res = await app.request('POST', '/api/check', { body: { image_base64: photo.toString('base64'), days_hung: 7 } });
      assert.equal(res.status, 200);
      assert.equal(trap.calls.length, 0);
      assert.equal(phone.calls.length, 1);
      const call = phone.calls[0];
      assert.equal(call.url, 'http://127.0.0.1:8800/detect');
      assert.equal(call.opts.headers.Authorization, 'Bearer inference-key-123');
      const sent = await sharp(Buffer.from(call.body.image_base64, 'base64')).metadata();
      assert.equal(sent.format, 'jpeg');
      assert.ok(Math.max(sent.width, sent.height) <= 1280, 'downscaled before sending');
      // All 12 classes are listed, counted at/above the threshold
      assert.equal(Object.keys(res.body.counts).length, 12);
      assert.equal(res.body.counts.weevils, 14);
      assert.equal(res.body.counts.caterpillars, 1);
      assert.equal(res.body.counts.bees, 1);
      assert.equal(res.body.counts.wasps, 1);
      assert.equal(res.body.counts.moths, 0);
      assert.deepEqual(res.body.per_day, { pests: 2.1, predators: 0.1 }); // 15 pests, 1 predator over 7 days (rounded)
      assert.equal(res.body.vision.status, 'ok');
      assert.equal(res.body.vision.model, 'agropest12-yolov8s');
      assert.match(res.body.annotated_image, /^data:image\/jpeg/);
      assert.equal(res.body.vision.boxes, 18); // every box the model returned is drawn, incl. the low-confidence one
    } finally {
      await app.close();
    }
  });

  test('if the model is down the check says so - no counts are invented', async () => {
    const phone = fakeHttp(() => { throw Object.assign(new Error('connect ECONNREFUSED'), { request: {} }); });
    const app = await startApp({ env, phoneVisionHttp: phone });
    try {
      const res = await app.request('POST', '/api/check', { body: { image_base64: photo.toString('base64'), days_hung: 7 } });
      assert.equal(res.status, 200);
      assert.equal(res.body.vision.status, 'failed');
      assert.equal(res.body.vision.provider === 'demo-detector', false);
      assert.equal(res.body.counts, null);
      assert.equal(res.body.decision.decision, 'CHECK_TRAP');
    } finally {
      await app.close();
    }
  });

  test('health shows both models; without PHONE_VISION_URL phone photos keep using the trap model', async () => {
    const withPhone = await startApp({ env });
    try {
      const h = (await withPhone.request('GET', '/api/health')).body;
      assert.equal(h.services.phone_vision.provider, 'generic');
      assert.equal(h.services.phone_vision.model, 'agropest12'); // configured class group until the service reports its model
      assert.equal(h.services.phone_vision.key, 'PHONE_VISION_API_KEY'); // the NAME, never the value
      assert.ok(!JSON.stringify(h).includes('inference-key-123'));
    } finally {
      await withPhone.close();
    }
    const trap = fakeHttp(() => ({ image: { width: 100, height: 100 }, predictions: [] }));
    const without = await startApp({ env: { ROBOFLOW_API_KEY: 'rk' }, visionHttp: trap });
    try {
      const res = await without.request('POST', '/api/check', { body: { image_base64: photo.toString('base64'), days_hung: 7 } });
      assert.equal(res.status, 200);
      assert.equal(trap.calls.length, 1);
      assert.equal((await without.request('GET', '/api/health')).body.services.phone_vision, null);
    } finally {
      await without.close();
    }
  });
});

describe('Phone check with the experimental 29-class model', () => {
  test('real species ids, the assassin bug as a predator, caddisflies as neutral, and the experimental flag', async () => {
    const phone = fakeHttp(async ({ body }) => {
      const meta = await sharp(Buffer.from(body.image_base64, 'base64')).metadata();
      return {
        detections: [
          box('Helicoverpa armigera', 0.8, 0), box('Helicoverpa armigera', 0.7, 1), box('Spodoptera exigua', 0.6, 2),
          box('Sirthenea flavipes', 0.5, 3), box('Trichoptera', 0.9, 4),
        ],
        image_width: meta.width, image_height: meta.height, model: 'pest29-yolo11s-experimental', experimental: true,
      };
    });
    const app = await startApp({ env: { ...env, PHONE_VISION_CLASS_GROUP: 'pest29' }, phoneVisionHttp: phone });
    try {
      const res = await app.request('POST', '/api/check', { body: { image_base64: photo.toString('base64'), days_hung: 1 } });
      assert.equal(res.status, 200);
      assert.equal(Object.keys(res.body.counts).length, 29);
      assert.equal(res.body.counts.helicoverpa_armigera, 2);
      assert.equal(res.body.counts.spodoptera_exigua, 1);
      assert.deepEqual(res.body.per_day, { pests: 3, predators: 1 }); // caddisfly counted as neither
      assert.equal(res.body.vision.model, 'pest29-yolo11s-experimental');
      assert.equal(res.body.vision.experimental, true);
    } finally {
      await app.close();
    }
  });

  test('an unknown class group is a configuration error', async () => {
    await assert.rejects(startApp({ env: { ...env, PHONE_VISION_CLASS_GROUP: 'coco' } }), /PHONE_VISION_CLASS_GROUP must be one of/);
  });
});

describe('Beneficial classes', () => {
  test('bees and earthworms are counted as neither pests nor predators', () => {
    assert.deepEqual(splitCounts({ bees: 5, earthworms: 2, weevils: 3, wasps: 1 }), { pests: 3, predators: 1, beneficial: 7, dominant: 'weevils' });
    // existing trap classes are unchanged
    assert.deepEqual(splitCounts({ whitefly: 10, macrolophus: 2 }), { pests: 10, predators: 2, dominant: 'whitefly' });
  });
});
