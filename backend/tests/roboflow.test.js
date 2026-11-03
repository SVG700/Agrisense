/**
 * Roboflow sticky-trap detection: key/URL config, 4x4 tiling with border
 * de-duplication, WF/MR/NC class mapping, totals, annotated image, and the
 * labelled demo-detector fallback.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { loadConfig } from '../src/config.js';
import { createVision } from '../src/services/vision.js';
import { dedupeBoxes, mapTileBox, tileGrid } from '../src/services/tiling.js';
import { fakeHttp, startApp } from './helpers.js';

const W = 2600; // big enough for 4x4 tiles of at least 640 px
const H = 1950;
// Ground truth on a 2600x1950 card (pixel boxes). Tile 0 spans x 0-765, tile 1 starts at x 612.
const INSECTS = [
  { cls: 'WF', x: 100, y: 100, w: 24, h: 20 },
  { cls: 'WF', x: 700, y: 300, w: 24, h: 20 }, // inside the overlap of two tiles: seen twice, whole
  { cls: 'WF', x: 750, y: 1000, w: 30, h: 26 }, // crosses tile 0's right edge: whole in tile 1, cut in tile 0
  { cls: 'WF', x: 1400, y: 1200, w: 22, h: 18 },
  { cls: 'MR', x: 900, y: 420, w: 40, h: 14 },
  { cls: 'NC', x: 1700, y: 340, w: 36, h: 12 },
];

/** Card whose colour encodes position (R = x/8, G = y/6), so a crop can tell which tile it is. */
function jpeg(w = W, h = H) {
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      raw[i] = Math.floor(x / 8);
      raw[i + 1] = Math.floor(y / 6);
      raw[i + 2] = 40;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
}

/** Which tile a crop came from (tiles are cropped concurrently, so call order is not tile order). */
async function tileOf(buffer, tiles) {
  const { data } = await sharp(buffer).extract({ left: 0, top: 0, width: 8, height: 8 }).raw().toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  for (let i = 0; i < data.length; i += 3) {
    r += data[i];
    g += data[i + 1];
  }
  const left = (r / 64) * 8;
  const top = (g / 64) * 6;
  return tiles.reduce((best, t) => (Math.hypot(t.left - left, t.top - top) < Math.hypot(best.left - left, best.top - top) ? t : best));
}

/**
 * Fake Roboflow: each call is one tile (identified from its pixels). It reports
 * every insect that is visible in that tile, clipped to the tile like a real
 * detector, as centre-based pixel boxes in the coordinates of the image it was
 * sent (which may be downscaled).
 */
function fakeRoboflow(tiles) {
  return fakeHttp(async ({ body }) => {
    const meta = await sharp(Buffer.from(body, 'base64')).metadata();
    // the full-image pass has the whole card's aspect ratio and is never wider than 1280 px; tiles are found by their pixels
    const full = Math.abs(meta.width / meta.height - W / H) < 0.01 && meta.width === Math.min(W, 1280);
    const t = full ? { left: 0, top: 0, width: W, height: H } : await tileOf(Buffer.from(body, 'base64'), tiles);
    if (!full) assert.equal(meta.width, t.width); // tiles at or under 1280 px are sent at full resolution
    const s = meta.width / t.width;
    const predictions = [];
    for (const b of INSECTS) {
      const x1 = Math.max(b.x, t.left);
      const y1 = Math.max(b.y, t.top);
      const x2 = Math.min(b.x + b.w, t.left + t.width);
      const y2 = Math.min(b.y + b.h, t.top + t.height);
      if (x2 - x1 < 3 || y2 - y1 < 3) continue;
      predictions.push({
        class: b.cls,
        confidence: 0.9,
        x: ((x1 + x2) / 2 - t.left) * s,
        y: ((y1 + y2) / 2 - t.top) * s,
        width: (x2 - x1) * s,
        height: (y2 - y1) * s,
      });
    }
    return { image: { width: meta.width, height: meta.height }, predictions };
  });
}
let fake;

const visionFor = (env, http) => {
  const { config, errors } = loadConfig({ VISION_PROVIDER: 'roboflow', ...env });
  assert.deepEqual(errors, []);
  return createVision({ config, http, logger: { warn() {} } });
};

describe('Roboflow config', () => {
  test('ROBOFLOW_API_KEY is the main name, YOLO_API_KEY the fallback; URL and model have defaults', () => {
    const a = loadConfig({ ROBOFLOW_API_KEY: 'rk', YOLO_API_KEY: 'yk' }).config.vision;
    assert.equal(a.apiKey, 'rk');
    assert.equal(a.keySource, 'ROBOFLOW_API_KEY');
    assert.equal(a.url, 'https://serverless.roboflow.com/yellow-sticky-traps-bwxut-ieond/1');
    const b = loadConfig({ YOLO_API_KEY: 'yk', YOLO_API_URL: 'https://serverless.roboflow.com' }).config.vision;
    assert.equal(b.apiKey, 'yk');
    assert.equal(b.keySource, 'YOLO_API_KEY');
    assert.equal(b.url, 'https://serverless.roboflow.com/yellow-sticky-traps-bwxut-ieond/1');
    assert.equal(loadConfig({}).config.vision.url, ''); // no key -> not configured
    // A plain label in VISION_MODEL_ID must not break the Roboflow URL; project/version ids are used
    const label = loadConfig({ YOLO_API_KEY: 'k', VISION_MODEL_ID: 'agrisense-trap-pest-prototype' }).config.vision;
    assert.equal(label.url, 'https://serverless.roboflow.com/yellow-sticky-traps-bwxut-ieond/1');
    assert.equal(loadConfig({ YOLO_API_KEY: 'k', ROBOFLOW_MODEL: 'my-traps/7' }).config.vision.url, 'https://serverless.roboflow.com/my-traps/7');
    assert.ok(loadConfig({ ROBOFLOW_API_KEY: 'k', VISION_TILE_OVERLAP: '0.9' }).errors.some((e) => e.includes('OVERLAP')));
  });

  test('health shows the key NAME, never its value', async () => {
    const app = await startApp({ env: { ROBOFLOW_API_KEY: 'secret-roboflow-value', VISION_TILES: '4' } });
    try {
      const h = await app.request('GET', '/api/health');
      assert.ok(!JSON.stringify(h.body).includes('secret-roboflow-value'));
      assert.match(JSON.stringify(h.body), /ROBOFLOW_API_KEY/);
    } finally {
      await app.close();
    }
  });
});

describe('tiling', () => {
  test('a 4x4 grid with 20% overlap covers the image exactly', () => {
    const tiles = tileGrid(W, H, 4, 0.2);
    assert.equal(tiles.length, 16);
    assert.equal(tiles[0].left, 0);
    assert.equal(tiles[3].left + tiles[3].width, W);
    assert.equal(tiles[15].top + tiles[15].height, H);
    const ov = (tiles[0].left + tiles[0].width - tiles[1].left) / tiles[0].width;
    assert.ok(Math.abs(ov - 0.2) < 0.01);
  });

  test('tile boxes map back to the whole image', () => {
    const tile = { left: 500, top: 400, width: 500, height: 400 };
    assert.deepEqual(mapTileBox({ label: 'whitefly', confidence: 0.9, x: 0.5, y: 0.5, width: 0.1, height: 0.1 }, tile, 1000, 800), {
      label: 'whitefly',
      confidence: 0.9,
      x: 0.75,
      y: 0.75,
      width: 0.05,
      height: 0.05,
    });
  });

  test('dedupe: same insect from two tiles (IoU) and an insect cut at a tile edge (containment)', () => {
    const whole = { label: 'whitefly', confidence: 0.9, x: 0.1, y: 0.1, width: 0.02, height: 0.02 };
    const again = { ...whole, confidence: 0.85, x: 0.1005 };
    const half = { ...whole, confidence: 0.8, width: 0.009 };
    const other = { ...whole, label: 'macrolophus' }; // different class at the same spot is kept
    assert.equal(dedupeBoxes([half, again, whole, other]).length, 2);
  });
});

describe('Roboflow detection (mocked API)', () => {
  test('uploaded photo: full pass + 16 tiles, boxes merged across seams, WF/MR/NC mapped, totals + annotated image', async () => {
    const tiles = tileGrid(W, H, 4, 0.2);
    fake = fakeRoboflow(tiles);
    const vision = visionFor({ ROBOFLOW_API_KEY: 'rk', VISION_TILES: '4' }, fake);
    const r = await vision.detect({ image: { buffer: await jpeg(), contentType: 'image/jpeg' } });
    assert.equal(r.status, 'ok');
    assert.equal(fake.calls.length, 17); // 1 full-image pass + 4x4 tiles
    assert.equal(fake.calls[0].url, 'https://serverless.roboflow.com/yellow-sticky-traps-bwxut-ieond/1');
    assert.equal(fake.calls[0].opts.params.api_key, 'rk');
    assert.deepEqual(r.counts, { whitefly: 4, macrolophus: 1, nesidiocoris: 1 });
    assert.deepEqual(r.totals, { pests: 4, predators: 2, dominant: 'whitefly' });
    assert.deepEqual(r.image, { width: W, height: H, tiles: 16, grid: '4x4' });
    // boxes are on the whole image
    const wf = r.boxes.find((b) => Math.abs(b.x - 100 / W) < 0.002);
    assert.ok(wf && Math.abs(wf.width - 24 / W) < 0.002);
    assert.match(r.annotated_image, /^data:image\/jpeg;base64,/);
  });

  test('tiles are never smaller than the model input: small photos are sent whole', async () => {
    const tiles = [{ left: 0, top: 0, width: 640, height: 480 }];
    fake = fakeRoboflow(tiles);
    const vision = visionFor({ ROBOFLOW_API_KEY: 'rk', VISION_TILES: '4' }, fake);
    const r = await vision.detect({ image: { buffer: await jpeg(640, 480), contentType: 'image/jpeg' } });
    assert.equal(fake.calls.length, 1);
    assert.equal(r.image.tiles, 1);
  });

  test('API failure -> labelled demo-detector counts, no boxes on the real photo', async () => {
    const http = fakeHttp(() => {
      throw Object.assign(new Error('boom'), { response: { status: 503 } });
    });
    const vision = visionFor({ ROBOFLOW_API_KEY: 'rk', VISION_TILES: '4' }, http);
    const r = await vision.detect({ image: { buffer: await jpeg(), contentType: 'image/jpeg' } });
    assert.equal(r.status, 'simulated');
    assert.equal(r.provider, 'demo-detector');
    assert.equal(r.fallback.reason, 'failed');
    assert.equal(r.fallback.error.code, 'http_503');
    assert.deepEqual(r.boxes, []);
    assert.ok(r.totals.pests > 0);
    assert.match(r.annotated_image, /^data:image\/jpeg/);
  });

  test('no key -> demo detector (labelled); fallback off -> not_configured / failed', async () => {
    const photo = { image: { buffer: await jpeg(), contentType: 'image/jpeg' } };
    const noKey = await visionFor({}).detect(photo);
    assert.equal(noKey.status, 'simulated');
    assert.equal(noKey.fallback.reason, 'not_configured');

    assert.equal((await visionFor({ VISION_DEMO_FALLBACK: 'false' }).detect(photo)).status, 'not_configured');
    const http = fakeHttp(() => {
      throw Object.assign(new Error('t'), { code: 'ECONNABORTED' });
    });
    const failed = await visionFor({ ROBOFLOW_API_KEY: 'rk', VISION_DEMO_FALLBACK: 'false' }, http).detect(photo);
    assert.equal(failed.status, 'failed');
    assert.equal(failed.error.code, 'timeout');
  });

  test('ingestion stores totals + fallback and returns the annotated image to the uploader', async () => {
    const app = await startApp({ env: { VISION_DEMO_FALLBACK: 'true' } });
    try {
      const res = await app.request('POST', '/api/telemetry', {
        body: { temperature: 25, image_base64: (await jpeg(800, 600)).toString('base64') },
      });
      assert.equal(res.status, 201);
      const meta = res.body.telemetry.detection.vision_meta;
      assert.equal(meta.provider, 'demo-detector');
      assert.equal(meta.fallback.reason, 'not_configured');
      assert.ok(meta.totals.pests >= 0);
      assert.match(res.body.annotated_image, /^data:image\/jpeg/);
      assert.equal(res.body.telemetry.detection.ai_advisory.decision.decision !== undefined, true);
    } finally {
      await app.close();
    }
  });
});
