/**
 * Gemini advisor + device-key binding tests. The Gemini client is a fake with
 * the same `models.generateContent` shape as @google/genai; no network calls.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { classifyGeminiError } from '../src/services/advisor.js';
import { DEVICE, OTHER_DEVICE, VALID_ADVISORY, mockTrapUrl, startApp } from './helpers.js';

const GEMINI_ENV = { GEMINI_API_KEY: 'gemini-test-not-real' };
const capture = (over = {}) => ({ device_id: DEVICE, temperature: 26.5, humidity: 78, image_url: mockTrapUrl(), ...over });

/** Fake GoogleGenAI client. */
function fakeGemini(respond) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (params) => {
        calls.push(params);
        return respond(params);
      },
    },
  };
}

const geminiText = (obj, extra = {}) => ({
  text: typeof obj === 'string' ? obj : JSON.stringify(obj),
  candidates: [{ finishReason: 'STOP' }],
  modelVersion: 'gemini-3.8-flash',
  ...extra,
});

const apiError = (status, message = 'error') => Object.assign(new Error(message), { status });

async function advisoryFor(client, env = GEMINI_ENV) {
  const app = await startApp({ env, llmClient: client });
  try {
    return (await app.request('POST', '/api/telemetry', { body: capture() })).body.telemetry.detection.ai_advisory;
  } finally {
    await app.close();
  }
}

describe('provider selection', () => {
  test('auto prefers Gemini, then Claude, then rule engine', () => {
    assert.equal(loadConfig({ GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a' }).config.advisor.provider, 'gemini');
    assert.equal(loadConfig({ ANTHROPIC_API_KEY: 'a' }).config.advisor.provider, 'claude');
    assert.equal(loadConfig({}).config.advisor.provider, 'none');
    assert.equal(loadConfig({ GEMINI_API_KEY: 'g', ADVISOR_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'a' }).config.advisor.provider, 'claude');
  });

  test('explicit provider without its key is a config error', () => {
    assert.ok(loadConfig({ ADVISOR_PROVIDER: 'gemini' }).errors.some((e) => e.includes('GEMINI_API_KEY')));
    assert.ok(loadConfig({ ADVISOR_PROVIDER: 'gpt' }).errors.some((e) => e.includes('ADVISOR_PROVIDER')));
  });
});

describe('Gemini advisory (mocked)', () => {
  test('valid output is saved as source=gemini; request uses validated data + JSON schema', async () => {
    const gemini = fakeGemini(() => geminiText(VALID_ADVISORY));
    const adv = await advisoryFor(gemini);
    assert.equal(adv.source, 'gemini');
    assert.equal(adv.status, 'ok');
    assert.equal(adv.model, 'gemini-3.8-flash');
    assert.equal(adv.risk_level, 'High');
    const p = gemini.calls[0];
    assert.equal(p.model, 'gemini-3.8-flash');
    assert.equal(p.config.responseMimeType, 'application/json');
    assert.deepEqual(p.config.responseJsonSchema.required, ['risk_level', 'confidence', 'summary', 'recommendation', 'mitigation_strategy']);
    assert.match(p.config.systemInstruction, /Never state exact pesticide doses/);
    assert.match(p.contents, /SIMULATED/);
  });

  test('health reports the Gemini provider without the key', async () => {
    const app = await startApp({ env: GEMINI_ENV, llmClient: fakeGemini(() => geminiText(VALID_ADVISORY)) });
    try {
      const h = (await app.request('GET', '/api/health')).body;
      assert.deepEqual(h.services.advisor, { state: 'configured', provider: 'gemini', model: 'gemini-3.8-flash' });
      assert.equal(h.integrations.gemini, true);
      assert.ok(!JSON.stringify(h).includes('gemini-test-not-real'));
    } finally {
      await app.close();
    }
  });

  test('failures fall back to the rule engine, labelled with provider + reason', async () => {
    const cases = [
      [() => geminiText('not json'), 'invalid_json'],
      [() => geminiText({ ...VALID_ADVISORY, risk_level: 'Severe' }), 'invalid_output'],
      [() => geminiText('', { text: undefined }), 'invalid_output'],
      [() => geminiText('{}', { candidates: [{ finishReason: 'SAFETY' }] }), 'refusal'],
      [() => geminiText('', { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }), 'refusal'],
      [() => geminiText('{"risk_level":', { candidates: [{ finishReason: 'MAX_TOKENS' }] }), 'truncated'],
      [() => { throw apiError(429, 'Resource exhausted'); }, 'rate_limited'],
      [() => { throw apiError(400, 'API key not valid. Please pass a valid API key.'); }, 'auth_error'],
      [() => { throw apiError(404, 'models/x is not found'); }, 'model_not_found'],
      [() => { throw apiError(503, 'overloaded'); }, 'api_unavailable'],
      [() => { throw new TypeError('fetch failed'); }, 'network_error'],
    ];
    for (const [respond, code] of cases) {
      const adv = await advisoryFor(fakeGemini(respond));
      assert.equal(adv.source, 'rule-engine', code);
      assert.equal(adv.status, 'fallback', code);
      assert.equal(adv.degraded, true);
      assert.equal(adv.error.provider, 'gemini');
      assert.equal(adv.error.code, code);
    }
  });

  test('timeout errors are classified', () => {
    assert.equal(classifyGeminiError(Object.assign(new Error('aborted'), { name: 'AbortError' })).code, 'timeout');
  });
});

describe('device-bound keys', () => {
  const key = 'bound-key-0123456789abcdef';
  const env = { DEVICE_API_KEYS: `${DEVICE}:${key}`, ADMIN_API_KEY: 'admin-key-0123456789abcdef' };

  test('a bound key can only post for its own device; device_id defaults to it', async () => {
    const app = await startApp({ env });
    try {
      const headers = { Authorization: `Bearer ${key}` };
      assert.equal((await app.request('POST', '/api/telemetry', { body: capture(), headers })).status, 201);
      const other = await app.request('POST', '/api/telemetry', { body: capture({ device_id: OTHER_DEVICE }), headers });
      assert.equal(other.status, 403);
      assert.equal(other.body.code, 'device_mismatch');
      const implicit = await app.request('POST', '/api/telemetry', { body: capture({ device_id: undefined }), headers });
      assert.equal(implicit.body.telemetry.device_id, DEVICE);
      // the whole "<uuid>:<key>" string is not itself a valid key
      const raw = await app.request('POST', '/api/telemetry', { body: capture(), headers: { Authorization: `Bearer ${DEVICE}:${key}` } });
      assert.equal(raw.status, 403);
    } finally {
      await app.close();
    }
  });

  test('short bound keys are rejected at startup', () => {
    assert.ok(loadConfig({ DEVICE_API_KEYS: `${DEVICE}:short` }).errors.some((e) => e.includes('16 characters')));
  });
});
