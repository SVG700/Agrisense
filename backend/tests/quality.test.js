/**
 * Image quality gate: blurry / dark / overexposed / glary photos are not
 * counted (no model call, no demo counts) and the trap shows CHECK TRAP with
 * retake advice. Test photos are a rendered sticky card degraded with sharp.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadConfig } from '../src/config.js';
import { assessQuality } from '../src/services/imageQuality.js';
import { renderTrapSvg } from '../src/services/mockTrap.js';
import { createVision } from '../src/services/vision.js';
import { ADMIN_KEY, fakeHttp, startApp } from './helpers.js';

const W = 1600;
const H = 1200;
const photos = {};

before(async () => {
  const card = await sharp(Buffer.from(renderTrapSvg('quality', 0.9, { mix: 'wf', predators: 0.1 })), { density: 144 })
    .resize(W, H)
    .jpeg({ quality: 88 })
    .toBuffer();
  const glare = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><ellipse cx="800" cy="560" rx="430" ry="260" fill="white"/></svg>`
  );
  Object.assign(photos, {
    good: card,
    dim: await sharp(card).linear(0.55, 0).jpeg().toBuffer(), // dim but sharp: still fine
    blurry: await sharp(card).blur(6).jpeg().toBuffer(),
    dark: await sharp(card).linear(0.18, 0).jpeg().toBuffer(),
    bright: await sharp(card).linear(1.4, 70).jpeg().toBuffer(),
    glare: await sharp(card).composite([{ input: glare }]).jpeg().toBuffer(),
  });
});

describe('assessQuality', () => {
  test('good and dim-but-sharp photos pass', async () => {
    for (const k of ['good', 'dim']) {
      const q = await assessQuality(photos[k]);
      assert.equal(q.ok, true, `${k}: ${JSON.stringify(q.metrics)}`);
      assert.equal(q.reason, null);
    }
  });

  test('each problem is named, explained and comes with retake advice', async () => {
    const expected = { blurry: /too blurry/, dark: /too dark/, bright: /overexposed/, glare: /glare/ };
    for (const [k, re] of Object.entries(expected)) {
      const q = await assessQuality(photos[k]);
      assert.equal(q.ok, false, k);
      assert.deepEqual(q.issues, [k]);
      assert.match(q.reason, re);
      assert.match(q.reason, /Retake it/);
      assert.equal(q.thresholds.placeholder, true);
    }
  });
});

describe('quality gate in detection', () => {
  const visionFor = (env, http) => {
    const { config } = loadConfig({ ROBOFLOW_API_KEY: 'rk', VISION_TILES: '1', ...env });
    return createVision({ config, http, logger: { warn() {} } });
  };
  const ok = () => fakeHttp(() => ({ image: { width: W, height: H }, predictions: [] }));

  test('a poor photo is not sent to the model and does not fall back to demo counts', async () => {
    const http = ok();
    const r = await visionFor({}, http).detect({ image: { buffer: photos.blurry, contentType: 'image/jpeg' } });
    assert.equal(http.calls.length, 0);
    assert.equal(r.status, 'failed');
    assert.equal(r.error.code, 'poor_image');
    assert.deepEqual(r.quality.issues, ['blurry']);
    assert.equal(r.counts, null);
    assert.match(r.annotated_image, /^data:image\/jpeg/); // banner tells the user to retake it
  });

  test('a good photo is checked, then detected; quality metrics are kept', async () => {
    const http = ok();
    const r = await visionFor({}, http).detect({ image: { buffer: photos.good, contentType: 'image/jpeg' } });
    assert.equal(http.calls.length, 1);
    assert.equal(r.status, 'ok');
    assert.equal(r.quality.ok, true);
    assert.ok(r.quality.metrics.sharpness > 30);
  });

  test('VISION_QUALITY_CHECK=false skips the gate', async () => {
    const r = await visionFor({ VISION_QUALITY_CHECK: 'false' }, ok()).detect({ image: { buffer: photos.dark, contentType: 'image/jpeg' } });
    assert.equal(r.status, 'ok');
    assert.equal(r.quality, null); // not assessed
  });

  test('ingesting a glary photo -> CHECK TRAP with the retake advice, everywhere', async () => {
    const app = await startApp({ env: { VISION_QUALITY_CHECK: 'true', ADMIN_API_KEY: ADMIN_KEY } });
    try {
      const res = await app.request('POST', '/api/telemetry', {
        body: { temperature: 26, image_base64: photos.glare.toString('base64') },
      });
      assert.equal(res.status, 201);
      const det = res.body.telemetry.detection;
      assert.equal(det.vision_meta.status, 'failed');
      assert.equal(det.vision_meta.error.code, 'poor_image');
      assert.deepEqual(det.vision_meta.quality.issues, ['glare']);
      const decision = det.ai_advisory.decision;
      assert.equal(decision.decision, 'CHECK_TRAP');
      assert.match(decision.reason, /glare.*Tilt the phone/);

      // The trap card (decision API) gives the same specific advice
      const api = await app.request('GET', `/api/decision?device_id=${res.body.telemetry.device_id}`);
      assert.equal(api.body.decision, 'CHECK_TRAP');
      assert.match(api.body.reason, /Tilt the phone/);
    } finally {
      await app.close();
    }
  });
});
