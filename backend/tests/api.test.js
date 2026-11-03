/**
 * HTTP-level tests for ingestion, auth, idempotency, failures and health.
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createMemoryStore } from '../src/db/memoryStore.js';
import { StoreError } from '../src/utils/validate.js';
import {
  ADMIN_KEY,
  DEVICE,
  DEVICE_KEY,
  GIF_BASE64,
  OTHER_DEVICE,
  PNG_BASE64,
  VALID_ADVISORY,
  claudeText,
  fakeClaude,
  fakeHttp,
  mockTrapUrl,
  sdkError,
  startApp,
} from './helpers.js';

const capture = (over = {}) => ({ device_id: DEVICE, temperature: 26.5, humidity: 78, image_url: mockTrapUrl(), ...over });

describe('POST /api/telemetry - validation', () => {
  test('1. valid telemetry is stored with simulated detections and labelled sources', async () => {
    const app = await startApp();
    try {
      const res = await app.request('POST', '/api/telemetry', { body: capture() });
      assert.equal(res.status, 201);
      const det = res.body.telemetry.detection;
      assert.equal(det.vision_meta.status, 'simulated');
      assert.ok(det.bounding_boxes.length > 0);
      assert.equal(res.body.sources.vision, 'simulated');
      assert.equal(det.ai_advisory.source, 'rule-engine');
      assert.equal(det.ai_advisory.status, 'not_configured');
      assert.ok(['Low', 'Medium', 'High'].includes(det.ai_advisory.risk_level));
      assert.match(res.body.telemetry.capture_id, /^[0-9a-f-]{36}$/);
      assert.equal(res.body.telemetry.data_source, 'unknown');
      const sim = await app.request('POST', '/api/telemetry', { body: capture({ data_source: 'simulator' }) });
      assert.equal(sim.body.telemetry.data_source, 'simulator');
      assert.equal((await app.request('POST', '/api/telemetry', { body: capture({ data_source: 'satellite' }) })).status, 400);
      const list = await app.request('GET', `/api/telemetry?device_id=${DEVICE}`);
      assert.equal(list.body.length, 2);
    } finally {
      await app.close();
    }
  });

  test('2. missing/empty payloads are rejected', async () => {
    const app = await startApp();
    try {
      assert.equal((await app.request('POST', '/api/telemetry', { body: {} })).body.code, 'empty_capture');
      assert.equal((await app.request('POST', '/api/telemetry', { body: [1, 2] })).status, 400);
      const bad = await app.request('POST', '/api/telemetry', { body: capture({ temperature: 'hot' }) });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.code, 'invalid_temperature');
      const json = await app.request('POST', '/api/telemetry', { raw: '{bad' });
      assert.equal(json.status, 400);
      assert.equal(json.body.code, 'invalid_json');
    } finally {
      await app.close();
    }
  });

  test('3. invalid device id', async () => {
    const app = await startApp();
    try {
      const res = await app.request('POST', '/api/telemetry', { body: capture({ device_id: 'pi-1' }) });
      assert.equal(res.status, 400);
      assert.equal(res.body.code, 'invalid_device_id');
    } finally {
      await app.close();
    }
  });

  test('4. invalid image type and oversized images', async () => {
    const app = await startApp({ env: { MAX_IMAGE_BYTES: '2048' } });
    try {
      const gif = await app.request('POST', '/api/telemetry', { body: capture({ image_url: undefined, image_base64: GIF_BASE64 }) });
      assert.equal(gif.status, 415);
      assert.equal(gif.body.code, 'unsupported_image_type');
      const notB64 = await app.request('POST', '/api/telemetry', { body: capture({ image_url: undefined, image_base64: '%%%' }) });
      assert.equal(notB64.status, 400);
      const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(4096)]).toString('base64');
      const tooBig = await app.request('POST', '/api/telemetry', { body: capture({ image_url: undefined, image_base64: big }) });
      assert.equal(tooBig.status, 413);
      assert.equal(tooBig.body.code, 'image_too_large');
      const both = await app.request('POST', '/api/telemetry', { body: capture({ image_base64: PNG_BASE64 }) });
      assert.equal(both.body.code, 'ambiguous_image');
      const ftp = await app.request('POST', '/api/telemetry', { body: capture({ image_url: 'ftp://x/y.jpg' }) });
      assert.equal(ftp.body.code, 'invalid_image_url');
    } finally {
      await app.close();
    }
  });

  test('5. out-of-range readings are rejected (not clamped); missing readings are stored as null; zero is valid', async () => {
    const app = await startApp();
    try {
      const hot = await app.request('POST', '/api/telemetry', { body: capture({ humidity: 150 }) });
      assert.equal(hot.status, 422);
      assert.equal(hot.body.code, 'sensor_out_of_range');
      assert.equal((await app.request('GET', '/api/telemetry')).body.length, 0, 'nothing stored');

      const missing = await app.request('POST', '/api/telemetry', { body: capture({ temperature: null, humidity: 0 }) });
      assert.equal(missing.status, 201);
      assert.equal(missing.body.telemetry.temperature, null);
      assert.equal(missing.body.telemetry.humidity, 0);

      const future = await app.request('POST', '/api/telemetry', {
        body: capture({ timestamp: new Date(Date.now() + 3600e3).toISOString() }),
      });
      assert.equal(future.status, 422);
    } finally {
      await app.close();
    }
  });
});

describe('Claude advisory integration (mocked)', () => {
  test('6. Claude unavailable -> capture saved, advisory is labelled rule-engine fallback', async () => {
    const claude = fakeClaude(() => {
      throw sdkError('APIConnectionError');
    });
    const app = await startApp({ env: { ANTHROPIC_API_KEY: 'sk-test-not-real' }, llmClient: claude });
    try {
      const res = await app.request('POST', '/api/telemetry', { body: capture() });
      assert.equal(res.status, 201);
      const adv = res.body.telemetry.detection.ai_advisory;
      assert.equal(adv.source, 'rule-engine');
      assert.equal(adv.status, 'fallback');
      assert.equal(adv.degraded, true);
      assert.equal(adv.error.code, 'network_error');
      assert.equal(res.body.sources.advisory, 'rule-engine');
    } finally {
      await app.close();
    }
  });

  test('7. malformed / schema-invalid / refused Claude output is never saved as Claude', async () => {
    const cases = [
      [claudeText('this is not json'), 'invalid_json'],
      [claudeText({ ...VALID_ADVISORY, risk_level: 'Extreme' }), 'invalid_output'],
      [claudeText({ ...VALID_ADVISORY, delete_table: 'devices' }), 'invalid_output'],
      [claudeText('{}', { stop_reason: 'refusal', stop_details: { category: 'bio' } }), 'refusal'],
      [claudeText('{"risk_level":', { stop_reason: 'max_tokens' }), 'truncated'],
    ];
    for (const [response, code] of cases) {
      const app = await startApp({ env: { ANTHROPIC_API_KEY: 'sk-test-not-real' }, llmClient: fakeClaude(() => response) });
      try {
        const adv = (await app.request('POST', '/api/telemetry', { body: capture() })).body.telemetry.detection.ai_advisory;
        assert.equal(adv.source, 'rule-engine', code);
        assert.equal(adv.error.code, code);
      } finally {
        await app.close();
      }
    }
  });

  test('16. valid Claude output is saved as source=claude with request built from validated data', async () => {
    const claude = fakeClaude(() =>
      claudeText({ ...VALID_ADVISORY, mitigation_strategy: ['Spray 2 ml/L of product X.', 'Scout daily.'] })
    );
    const app = await startApp({ env: { ANTHROPIC_API_KEY: 'sk-test-not-real' }, llmClient: claude });
    try {
      const adv = (await app.request('POST', '/api/telemetry', { body: capture() })).body.telemetry.detection.ai_advisory;
      assert.equal(adv.source, 'claude');
      assert.equal(adv.status, 'ok');
      assert.equal(adv.risk_level, 'High');
      assert.ok(!adv.mitigation_strategy[0].includes('2 ml/L'), 'invented doses are scrubbed');
      const params = claude.calls[0];
      assert.equal(params.model, 'claude-opus-5-5');
      assert.equal(params.output_config.format.type, 'json_schema');
      assert.equal(params.fallbacks, undefined, 'no automatic model switching');
      assert.match(params.messages[0].content, /SIMULATED/);
      assert.match(params.messages[0].content, /capture_time_utc/);
    } finally {
      await app.close();
    }
  });
});

describe('Vision provider integration (mocked)', () => {
  const env = { YOLO_API_URL: 'https://vision.example.test/model/1', YOLO_API_KEY: 'vision-test-key' };

  test('8. timeout -> detection failed, nothing invented, capture + readings saved, advisory skipped', async () => {
    const http = fakeHttp(() => {
      throw Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    });
    const app = await startApp({ env, visionHttp: http });
    try {
      const res = await app.request('POST', '/api/telemetry', { body: capture({ image_url: undefined, image_base64: PNG_BASE64 }) });
      assert.equal(res.status, 201);
      const det = res.body.telemetry.detection;
      assert.equal(det.vision_meta.status, 'failed');
      assert.equal(det.vision_meta.error.code, 'timeout');
      assert.deepEqual(det.bounding_boxes, []);
      assert.equal(det.ai_advisory.status, 'skipped');
      assert.equal(det.ai_advisory.risk_level, null);
      assert.equal(det.ai_advisory.decision.decision, 'CHECK_TRAP'); // grey ■ CHECK TRAP, never a guessed decision
      assert.equal(res.body.telemetry.temperature, 26.5);
    } finally {
      await app.close();
    }
  });

  test('9. zero detections are reported as zero (no mock substitution)', async () => {
    const http = fakeHttp(() => ({ image: { width: 1000, height: 800 }, predictions: [] }));
    const app = await startApp({ env, visionHttp: http });
    try {
      const res = await app.request('POST', '/api/telemetry', { body: capture({ image_url: 'https://cdn.example.test/trap.jpg' }) });
      const det = res.body.telemetry.detection;
      assert.equal(det.vision_meta.status, 'ok');
      assert.equal(det.vision_meta.source, 'yolo');
      assert.deepEqual(det.bounding_boxes, []);
      assert.equal(Object.values(det.pest_counts).reduce((a, b) => a + b, 0), 0);
      assert.equal(http.calls[0].opts.params.image, 'https://cdn.example.test/trap.jpg');
      // Roboflow's hosted API takes the key as api_key; it must never be echoed back or stored
      assert.equal(http.calls[0].opts.params.api_key, 'vision-test-key');
      assert.equal(http.calls[0].opts.headers.Authorization, undefined);
      assert.ok(!JSON.stringify(res.body).includes('vision-test-key'));
      assert.deepEqual(det.pest_counts, { whitefly: 0, macrolophus: 0, nesidiocoris: 0 });
    } finally {
      await app.close();
    }
  });

  test('10. malformed coordinates are rejected/clipped; malformed shape fails cleanly', async () => {
    const http = fakeHttp(() => ({
      image: { width: 1000, height: 1000 },
      predictions: [
        { x: 100, y: 100, width: 20, height: 20, class: 'Aphid', confidence: 0.9 }, // ok
        { x: 995, y: 500, width: 20, height: 20, class: 'whitefly', confidence: 0.8 }, // clipped
        { x: 'NaN', y: 1, width: 1, height: 1, class: 'aphid', confidence: 0.9 }, // rejected
        { x: 5000, y: 5000, width: 10, height: 10, class: 'aphid', confidence: 0.9 }, // outside
        { x: 10, y: 10, width: 5, height: 5, class: 'aphid', confidence: 7 }, // bad confidence
        { x: 10, y: 10, width: 5, height: 5, class: '<script>', confidence: 0.9 }, // bad label
      ],
    }));
    const app = await startApp({ env, visionHttp: http });
    try {
      const det = (await app.request('POST', '/api/telemetry', { body: capture({ image_url: 'https://cdn.example.test/t.jpg' }) })).body
        .telemetry.detection;
      assert.equal(det.bounding_boxes.length, 2);
      assert.equal(det.vision_meta.rejected, 4);
      for (const b of det.bounding_boxes) {
        assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 1 && b.y + b.height <= 1);
      }
      assert.equal(det.pest_counts.aphid, 1);
      assert.deepEqual(det.vision_meta.image, { width: 1000, height: 1000 });
    } finally {
      await app.close();
    }

    const broken = await startApp({ env, visionHttp: fakeHttp(() => ({ hello: 'world' })) });
    try {
      const det = (await broken.request('POST', '/api/telemetry', { body: capture({ image_url: 'https://cdn.example.test/t.jpg' }) })).body
        .telemetry.detection;
      assert.equal(det.vision_meta.status, 'failed');
      assert.equal(det.vision_meta.error.code, 'invalid_response');
    } finally {
      await broken.close();
    }
  });

  test('real image without a configured provider -> not_configured, no fabricated boxes', async () => {
    const app = await startApp();
    try {
      const det = (await app.request('POST', '/api/telemetry', { body: capture({ image_url: undefined, image_base64: PNG_BASE64 }) })).body
        .telemetry.detection;
      assert.equal(det.vision_meta.status, 'not_configured');
      assert.deepEqual(det.bounding_boxes, []);
      assert.equal(det.ai_advisory.status, 'skipped');
    } finally {
      await app.close();
    }
  });
});

describe('Persistence, idempotency and failures', () => {
  test('12. duplicate capture_id returns the original record without re-processing', async () => {
    const http = fakeHttp(() => ({ image: { width: 10, height: 10 }, predictions: [] }));
    const app = await startApp({
      env: { YOLO_API_URL: 'https://vision.example.test/m/1', YOLO_API_KEY: 'k' },
      visionHttp: http,
    });
    try {
      const body = capture({ capture_id: randomUUID(), image_url: undefined, image_base64: PNG_BASE64 });
      const first = await app.request('POST', '/api/telemetry', { body });
      const second = await app.request('POST', '/api/telemetry', { body });
      assert.equal(first.status, 201);
      assert.equal(second.status, 200);
      assert.equal(second.body.duplicate, true);
      assert.equal(second.body.telemetry.id, first.body.telemetry.id);
      assert.equal(http.calls.length, 1, 'vision called once');
      assert.equal((await app.request('GET', '/api/telemetry')).body.length, 1);

      const stolen = await app.request('POST', '/api/telemetry', { body: { ...body, device_id: OTHER_DEVICE } });
      assert.equal(stolen.status, 409);
    } finally {
      await app.close();
    }
  });

  test('11/15. database unavailable or write failure -> 503, nothing partially saved', async () => {
    const store = createMemoryStore();
    store.ingestCapture = async () => {
      throw new StoreError('ingestCapture', new Error('connection refused'));
    };
    store.ping = async () => {
      throw new StoreError('ping', new Error('connection refused'));
    };
    const app = await startApp({ store });
    try {
      const res = await app.request('POST', '/api/telemetry', { body: capture() });
      assert.equal(res.status, 503);
      assert.equal(res.body.code, 'database_unavailable');
      assert.ok(!JSON.stringify(res.body).includes('connection refused'), 'internal error text not leaked');
      assert.equal((await app.request('GET', '/api/telemetry')).body.length, 0);
      const ready = await app.request('GET', '/api/ready');
      assert.equal(ready.status, 503);
      assert.equal(ready.body.ready, false);
    } finally {
      await app.close();
    }
  });

  test('image upload failure -> 502 and no records', async () => {
    const store = createMemoryStore();
    store.uploadImage = async () => {
      throw new StoreError('uploadImage', new Error('bucket missing'));
    };
    const app = await startApp({ store });
    try {
      const res = await app.request('POST', '/api/telemetry', { body: capture({ image_url: undefined, image_base64: PNG_BASE64 }) });
      assert.equal(res.status, 502);
      assert.equal(res.body.code, 'image_upload_failed');
      assert.equal((await app.request('GET', '/api/telemetry')).body.length, 0);
    } finally {
      await app.close();
    }
  });
});

describe('Authentication and authorization', () => {
  const env = { DEVICE_API_KEYS: DEVICE_KEY, ADMIN_API_KEY: ADMIN_KEY };

  test('13. device ingestion requires a valid key (admin key also accepted)', async () => {
    const app = await startApp({ env });
    try {
      assert.equal((await app.request('POST', '/api/telemetry', { body: capture() })).status, 401);
      assert.equal(
        (await app.request('POST', '/api/telemetry', { body: capture(), headers: { Authorization: 'Bearer wrong-key-xxxxxxxxxx' } })).status,
        403
      );
      assert.equal((await app.request('POST', '/api/telemetry', { body: capture(), headers: { 'X-Device-Key': DEVICE_KEY } })).status, 201);
      assert.equal(
        (await app.request('POST', '/api/telemetry', { body: capture(), headers: { Authorization: `Bearer ${ADMIN_KEY}` } })).status,
        201
      );
    } finally {
      await app.close();
    }
  });

  test('14. battery override requires the admin key (device key is not enough)', async () => {
    const app = await startApp({ env });
    try {
      const body = { device_id: DEVICE, battery_level: 14 };
      assert.equal((await app.request('PATCH', '/api/device/battery', { body })).status, 401);
      assert.equal((await app.request('PATCH', '/api/device/battery', { body, headers: { 'X-Admin-Key': DEVICE_KEY } })).status, 403);
      const ok = await app.request('PATCH', '/api/device/battery', { body, headers: { 'X-Admin-Key': ADMIN_KEY } });
      assert.equal(ok.status, 200);
      assert.equal(ok.body.alert, 'LOW_BATTERY');
      assert.equal(ok.body.device.status, 'low_battery');
      assert.equal(ok.body.device.battery_source, 'manual');
      assert.ok(ok.body.device.battery_updated_at);
      assert.equal((await app.request('POST', '/api/devices', { body: { name: 'x' } })).status, 401);
    } finally {
      await app.close();
    }
  });

  test('battery validation: out of range rejected, unknown device 404', async () => {
    const app = await startApp();
    try {
      assert.equal((await app.request('PATCH', '/api/device/battery', { body: { device_id: DEVICE, battery_level: 150 } })).status, 422);
      assert.equal((await app.request('PATCH', '/api/device/battery', { body: { device_id: OTHER_DEVICE, battery_level: 50 } })).status, 404);
      const r = await app.request('PATCH', '/api/device/battery', { body: { device_id: DEVICE, battery_level: 15 } });
      assert.equal(r.body.alert, null, '15% is not below the threshold');
    } finally {
      await app.close();
    }
  });

  test('rate limiting returns 429 with Retry-After', async () => {
    const app = await startApp({ env: { RATE_LIMIT_ADMIN_MAX: '2' } });
    try {
      const body = { device_id: DEVICE, battery_level: 50 };
      await app.request('PATCH', '/api/device/battery', { body });
      await app.request('PATCH', '/api/device/battery', { body });
      const limited = await app.request('PATCH', '/api/device/battery', { body });
      assert.equal(limited.status, 429);
      assert.ok(limited.headers.get('retry-after'));
    } finally {
      await app.close();
    }
  });
});

describe('Health and misc', () => {
  test('17. health reports integration states without leaking secrets', async () => {
    const app = await startApp({
      env: { ANTHROPIC_API_KEY: 'sk-ant-secret-value', DEVICE_API_KEYS: DEVICE_KEY, ADMIN_API_KEY: ADMIN_KEY },
      llmClient: fakeClaude(() => claudeText(VALID_ADVISORY)),
    });
    try {
      const res = await app.request('GET', '/api/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.integrations.claude, true);
      assert.equal(res.body.services.advisor.state, 'configured');
      assert.equal(res.body.auth.device, 'required');
      assert.equal(res.body.low_battery_threshold, 15);
      const text = JSON.stringify(res.body);
      for (const secret of ['sk-ant-secret-value', DEVICE_KEY, ADMIN_KEY]) assert.ok(!text.includes(secret));
      assert.ok(res.headers.get('x-request-id'));
      assert.equal((await app.request('GET', '/api/ready')).status, 200);
    } finally {
      await app.close();
    }
  });

  test('unknown routes return JSON 404; CORS rejects foreign origins', async () => {
    const app = await startApp();
    try {
      const nf = await app.request('GET', '/api/nope');
      assert.equal(nf.status, 404);
      assert.equal(nf.body.code, 'route_not_found');
      const cors = await app.request('GET', '/api/devices', { headers: { Origin: 'https://evil.example' } });
      assert.equal(cors.status, 403);
    } finally {
      await app.close();
    }
  });
});
