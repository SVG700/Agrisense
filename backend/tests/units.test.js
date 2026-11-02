/**
 * Unit tests: config validation, vision normalization, advisory validation,
 * error classification and the Supabase store against a fake client.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { normalizeResponse, countPests } from '../src/services/vision.js';
import { validateAdvisory, classifyClaudeError, ruleBasedAdvisory } from '../src/services/advisor.js';
import { evaluateDecision } from '../src/services/decision.js';
import { createSupabaseStore } from '../src/db/supabaseStore.js';
import { StoreError } from '../src/utils/validate.js';
import { VALID_ADVISORY, sdkError } from './helpers.js';

describe('config', () => {
  test('empty env is a valid demo config with warnings', () => {
    const { errors, warnings, config } = loadConfig({});
    assert.deepEqual(errors, []);
    assert.equal(config.demoMode, true);
    assert.ok(warnings.some((w) => w.includes('UNAUTHENTICATED')));
  });

  test('invalid / partial configuration is reported (without secret values)', () => {
    const { errors } = loadConfig({
      SUPABASE_URL: 'https://x.supabase.co',
      CLAUDE_EFFORT: 'turbo',
      ADMIN_API_KEY: 'short',
      YOLO_API_URL: 'not a url',
      PORT: 'abc',
    });
    const text = errors.join('\n');
    assert.match(text, /SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(text, /CLAUDE_EFFORT/);
    assert.match(text, /ADMIN_API_KEY must be at least 16/);
    assert.match(text, /YOLO_API_URL/);
    assert.match(text, /PORT/);
    assert.ok(!text.includes('short'));
  });

  test('production requires auth keys', () => {
    const { errors, config } = loadConfig({ NODE_ENV: 'production' });
    assert.equal(config.demoMode, false);
    assert.ok(errors.some((e) => e.includes('DEVICE_API_KEYS')));
    assert.ok(errors.some((e) => e.includes('ADMIN_API_KEY')));
  });
});

describe('vision normalization', () => {
  test('roboflow centre coordinates become normalized corners', () => {
    const { boxes, image } = normalizeResponse('roboflow', {
      image: { width: 200, height: 100 },
      predictions: [{ x: 100, y: 50, width: 20, height: 10, class: 'Fungus Gnat', confidence: 0.77 }],
    });
    assert.deepEqual(image, { width: 200, height: 100 });
    assert.deepEqual(boxes[0], { label: 'fungus_gnat', confidence: 0.77, x: 0.45, y: 0.45, width: 0.1, height: 0.1 });
  });

  test('generic pixel and normalized bboxes', () => {
    const px = normalizeResponse('generic', {
      image_width: 100,
      image_height: 100,
      detections: [{ label: 'aphid', confidence: 0.9, bbox: [10, 10, 20, 30] }],
    });
    assert.deepEqual(px.boxes[0], { label: 'aphid', confidence: 0.9, x: 0.1, y: 0.1, width: 0.1, height: 0.2 });
    const unscaled = normalizeResponse('generic', { detections: [{ label: 'aphid', confidence: 0.9, bbox: [10, 10, 20, 30] }] });
    assert.equal(unscaled.boxes.length, 0);
    assert.equal(unscaled.rejected, 1);
  });

  test('roboflow response without image size is rejected', () => {
    assert.throws(() => normalizeResponse('roboflow', { predictions: [] }), /image dimensions/);
  });

  test('counts respect the confidence threshold', () => {
    const counts = countPests(
      [
        { label: 'aphid', confidence: 0.9 },
        { label: 'aphid', confidence: 0.3 },
        { label: 'leafhopper', confidence: 0.6 },
      ],
      0.5
    );
    assert.equal(counts.aphid, 1);
    assert.equal(counts.leafhopper, 1);
    assert.equal(counts.whitefly, 0);
  });
});

describe('advisory', () => {
  test('validateAdvisory accepts the schema and rejects junk', () => {
    assert.equal(validateAdvisory(VALID_ADVISORY).ok, true);
    assert.equal(validateAdvisory(null).ok, false);
    assert.equal(validateAdvisory({ ...VALID_ADVISORY, mitigation_strategy: [] }).ok, false);
    assert.equal(validateAdvisory({ ...VALID_ADVISORY, summary: 42 }).ok, false);
  });

  test('SDK errors map to stable codes', () => {
    assert.equal(classifyClaudeError(sdkError('AuthenticationError', 401)).code, 'auth_error');
    assert.equal(classifyClaudeError(sdkError('RateLimitError', 429)).code, 'rate_limited');
    assert.equal(classifyClaudeError(sdkError('NotFoundError', 404)).code, 'model_not_found');
    assert.equal(classifyClaudeError(sdkError('APIConnectionTimeoutError')).code, 'timeout');
    assert.equal(classifyClaudeError(sdkError('InternalServerError', 529)).code, 'api_unavailable');
    assert.equal(classifyClaudeError(new SyntaxError('x')).code, 'invalid_json');
  });

  test('rule engine flags thin evidence and handles missing readings', () => {
    const adv = ruleBasedAdvisory({
      pest_counts: { aphid: 3 },
      temperature: null,
      humidity: null,
      history: [],
      detection: { simulated: true, mean_confidence: 0.9 },
    });
    assert.equal(adv.confidence, 'Low');
    assert.match(adv.summary, /not measured/);
    assert.match(adv.summary, /Limited evidence/);
    assert.ok(!/\d+\s?ml/i.test(adv.mitigation_strategy.join(' ')));
  });

  test('rule engine explains and follows the predator-aware decision', () => {
    const base = { pest_counts: { whitefly: 60, macrolophus: 20 }, temperature: 26, humidity: 60, history: [], detection: {} };
    const bio = ruleBasedAdvisory({
      ...base,
      decision: evaluateDecision([{ date: '2026-10-01', pests: 60, predators: 20, confidence: 0.9 }]),
    });
    assert.equal(bio.risk_level, 'Medium');
    assert.match(bio.summary, /^RELEASE BIOCONTROL:/);
    assert.match(bio.recommendation, /natural enemies/);

    const edge = ruleBasedAdvisory({ ...base, decision: evaluateDecision([{ date: '2026-10-01', pests: 26, predators: 0 }]) });
    assert.equal(edge.risk_level, 'High');
    assert.match(edge.recommendation, /close to a threshold/);
  });
});

describe('supabase store (fake client)', () => {
  const config = { supabase: { bucket: 'trap-images', signedUrlTtlSec: 60 } };

  function fakeSupabase({ rpcResult, rpcError, signed = true } = {}) {
    const calls = [];
    return {
      calls,
      rpc: async (fn, args) => {
        calls.push({ fn, args });
        return rpcError ? { data: null, error: { message: rpcError } } : { data: rpcResult, error: null };
      },
      storage: {
        from: (bucket) => ({
          upload: async (path, _buf, opts) => {
            calls.push({ upload: { bucket, path, opts } });
            return { data: { path }, error: null };
          },
          createSignedUrls: async (paths, ttl) => {
            calls.push({ sign: { paths, ttl } });
            return signed
              ? { data: paths.map((p) => ({ path: p, signedUrl: `https://signed.test/${p}` })), error: null }
              : { data: null, error: { message: 'denied' } };
          },
        }),
      },
    };
  }

  test('ingestCapture calls the atomic RPC and signs private image paths', async () => {
    const client = fakeSupabase({
      rpcResult: {
        telemetry: { id: 7, capture_id: 'c', image_path: 'captures/d/c.jpg', image_url: null },
        detection: { id: 9, telemetry_id: 7 },
        duplicate: false,
      },
    });
    const store = createSupabaseStore({ config, client });
    const res = await store.ingestCapture({ telemetry: { capture_id: 'c' }, detection: {} });
    assert.equal(client.calls[0].fn, 'ingest_capture');
    assert.equal(res.telemetry.image_url, 'https://signed.test/captures/d/c.jpg');
    assert.equal(res.telemetry.detection.id, 9);
    assert.equal(res.duplicate, false);
  });

  test('RPC errors surface as StoreError; signing failure degrades to null url', async () => {
    const failing = createSupabaseStore({ config, client: fakeSupabase({ rpcError: 'boom' }) });
    await assert.rejects(failing.ingestCapture({ telemetry: {}, detection: {} }), StoreError);

    const unsigned = createSupabaseStore({
      config,
      client: fakeSupabase({
        signed: false,
        rpcResult: { telemetry: { id: 1, image_path: 'p.jpg' }, detection: null, duplicate: true },
      }),
    });
    const res = await unsigned.ingestCapture({ telemetry: {}, detection: {} });
    assert.equal(res.telemetry.image_url, null);
    assert.equal(res.duplicate, true);
  });

  test('ping fails when tables are missing (no false "ready")', async () => {
    const missing = { message: "Could not find the table 'public.devices' in the schema cache", code: 'PGRST205' };
    const client = {
      from: () => {
        const q = { select: () => q, limit: () => Promise.resolve({ data: null, error: missing }) };
        return q;
      },
    };
    const store = createSupabaseStore({ config, client });
    await assert.rejects(store.ping(), StoreError);
  });

  test('uploads use upsert on a deterministic path', async () => {
    const client = fakeSupabase();
    const store = createSupabaseStore({ config, client });
    const out = await store.uploadImage({ path: 'captures/d/c.png', buffer: Buffer.from('x'), contentType: 'image/png' });
    assert.equal(out.image_path, 'captures/d/c.png');
    assert.equal(client.calls[0].upload.opts.upsert, true);
  });
});
