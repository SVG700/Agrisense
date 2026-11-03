/**
 * Test harness: boots the real Express app on an ephemeral port with injected
 * mock providers. No real API keys or network calls are ever used.
 */
import { once } from 'node:events';
import Anthropic from '@anthropic-ai/sdk';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/utils/logger.js';
import { createMemoryStore } from '../src/db/memoryStore.js';
import { createVision } from '../src/services/vision.js';
import { createAdvisor } from '../src/services/advisor.js';
import { createApp } from '../src/app.js';

export const DEVICE = '11111111-1111-4111-8111-111111111111';
export const OTHER_DEVICE = '22222222-2222-4222-8222-222222222222';
export const DEVICE_KEY = 'device-key-0123456789abcdef';
export const ADMIN_KEY = 'admin-key-0123456789abcdef';

/** Smallest byte sequences that pass magic-number validation. */
export const PNG_BASE64 = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]).toString('base64');
export const GIF_BASE64 = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32)]).toString('base64');

export async function startApp({ env = {}, store, visionHttp, llmClient } = {}) {
  // Tiling and the demo fallback have their own tests; the rest exercise the plain provider path
  const { config, errors } = loadConfig({ DEMO_MODE: 'true', VISION_TILES: '1', VISION_DEMO_FALLBACK: 'false', ...env });
  if (errors.length) throw new Error(`Invalid test config: ${errors.join('; ')}`);
  const logger = createLogger({ silent: true });
  store ??= createMemoryStore();
  const vision = createVision({ config, http: visionHttp, logger });
  const advisor = createAdvisor({ config, client: llmClient, logger });
  const app = createApp({ config, store, vision, advisor, logger });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, path, { body, headers = {}, raw } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined || raw ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    return { status: res.status, body: json, headers: res.headers };
  }

  return { base, store, config, request, close: () => new Promise((r) => server.close(r)) };
}

/** Fake axios-like client for the vision provider. */
export function fakeHttp(handler) {
  const calls = [];
  return {
    calls,
    post: async (url, body, opts) => {
      calls.push({ url, body, opts });
      return { data: await handler({ url, body, opts }) };
    },
  };
}

/** Fake Anthropic client returning the given text (or throwing). */
export function fakeClaude(respond) {
  const calls = [];
  return {
    calls,
    messages: {
      create: async (params) => {
        calls.push(params);
        return respond(params);
      },
    },
  };
}

export const claudeText = (obj, extra = {}) => ({
  stop_reason: 'end_turn',
  model: 'claude-opus-5-5',
  content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
  ...extra,
});

/** Builds an SDK error instance without depending on constructor signatures. */
export function sdkError(name, status) {
  const err = Object.create(Anthropic[name].prototype);
  Object.assign(err, { status, message: `${name} (mock)` });
  return err;
}

export const VALID_ADVISORY = {
  risk_level: 'High',
  confidence: 'Medium',
  summary: 'Whitefly activity is rising in warm, humid conditions.',
  recommendation: 'Scout the crop near the trap within 24 hours.',
  mitigation_strategy: ['Scout plants near the trap.', 'Improve ventilation.', 'Release Encarsia formosa.'],
};

export const mockTrapUrl = (seed = 'seed1', d = 0.5) => `http://localhost:4000/api/mock-trap/${seed}.svg?d=${d}`;
