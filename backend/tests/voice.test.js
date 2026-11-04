/**
 * Natural voice (Gemini TTS) for "listen to the advice".
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createVoice, pcmToWav } from '../src/services/voice.js';
import { startApp } from './helpers.js';

const PCM = Buffer.alloc(4800, 1); // 0.1 s of 24 kHz 16-bit mono

/** GoogleGenAI-shaped fake: records requests, returns PCM audio (or throws). */
function fakeGemini({ fail } = {}) {
  const calls = [];
  return {
    calls,
    models: {
      generateContent: async (req) => {
        calls.push(req);
        if (fail) throw Object.assign(new Error('Resource exhausted'), { status: fail });
        return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: PCM.toString('base64') } }] } }] };
      },
    },
  };
}

const config = loadConfig({ DEMO_MODE: 'true', GEMINI_API_KEY: 'test-key' }).config;

describe('voice', () => {
  test('PCM is wrapped in a valid WAV header', () => {
    const wav = pcmToWav(PCM, 24_000);
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 24_000);
    assert.equal(wav.readUInt32LE(40), PCM.length);
    assert.equal(wav.length, 44 + PCM.length);
  });

  test('asks Gemini for audio with the configured voice, in the advisor style, and caches it', async () => {
    const client = fakeGemini();
    const voice = createVoice({ config, client });
    const a = await voice.speak({ text: 'Spray the east rows.', lang: 'en' });
    assert.equal(a.ok, true);
    assert.equal(a.cached, false);
    assert.equal(a.wav.toString('ascii', 0, 4), 'RIFF');
    const req = client.calls[0];
    assert.equal(req.model, 'gemini-3.8-flash-tts');
    assert.deepEqual(req.config.responseModalities, ['AUDIO']);
    assert.equal(req.config.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');
    assert.match(req.contents[0].parts[0].text, /agronomist[\s\S]*Spray the east rows\./);

    const b = await voice.speak({ text: 'Spray the east rows.', lang: 'en' });
    assert.equal(b.cached, true);
    assert.equal(client.calls.length, 1); // replay is free
    await voice.speak({ text: 'Spray the east rows.', lang: 'kn' });
    assert.equal(client.calls.length, 2); // another language is a new clip
  });

  test('POST /api/voice returns audio/wav; errors are clear; length is capped', async () => {
    const app = await startApp({ env: { GEMINI_API_KEY: 'test-key' }, voice: createVoice({ config, client: fakeGemini() }) });
    try {
      const res = await fetch(`${app.base}/api/voice`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Wait and keep monitoring.' }) });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('content-type'), 'audio/wav');
      assert.equal(Buffer.from(await res.arrayBuffer()).toString('ascii', 0, 4), 'RIFF');
      assert.equal((await app.request('POST', '/api/voice', { body: { text: '' } })).status, 422);
      assert.equal((await app.request('POST', '/api/voice', { body: { text: 'x'.repeat(1300) } })).status, 413);
    } finally {
      await app.close();
    }

    const quota = await startApp({ env: { GEMINI_API_KEY: 'test-key' }, voice: createVoice({ config, client: fakeGemini({ fail: 429 }) }) });
    try {
      const r = await quota.request('POST', '/api/voice', { body: { text: 'Hello' } });
      assert.equal(r.status, 429);
      assert.equal(r.body.code, 'voice_rate_limited');
      // Cool-down: the next request is refused at once, without calling Gemini again
      const again = await quota.request('POST', '/api/voice', { body: { text: 'Hello again' } });
      assert.equal(again.status, 429);
      assert.ok(Number(again.headers.get('retry-after')) > 0);
    } finally {
      await quota.close();
    }

    const none = await startApp({ env: { GEMINI_API_KEY: '' } });
    try {
      const r = await none.request('POST', '/api/voice', { body: { text: 'Hello' } });
      assert.equal(r.status, 503);
      assert.equal(r.body.code, 'voice_not_configured');
    } finally {
      await none.close();
    }
  });
});
