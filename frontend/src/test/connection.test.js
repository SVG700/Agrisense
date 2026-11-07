import { describe, expect, test, vi } from 'vitest';
import { checkConnection } from '../lib/connection.js';
import { AGRISENSE_BASE_URL, normalizeBaseUrl } from '../lib/baseUrl.js';

const BASE = 'http://10.193.42.16:5173';
const AGRISENSE_HEALTH = { ok: true, mode: 'demo', store: 'supabase' };
const ok = (status = 200, body = AGRISENSE_HEALTH) => Promise.resolve({ ok: status < 400, status, json: async () => body });

describe('AGRISENSE_BASE_URL', () => {
  test('comes from agrisense.json via vite.config (http, no /api, no trailing slash)', () => {
    expect(AGRISENSE_BASE_URL).toMatch(/^http:\/\/[^/]+$/);
  });

  test('normalising never doubles /api or leaves a trailing slash', () => {
    expect(normalizeBaseUrl('http://10.0.0.5:5173/')).toBe('http://10.0.0.5:5173');
    expect(normalizeBaseUrl('http://10.0.0.5:5173/api')).toBe('http://10.0.0.5:5173');
    expect(normalizeBaseUrl('http://10.0.0.5:5173/api/')).toBe('http://10.0.0.5:5173');
  });
});

describe('checkConnection', () => {
  test('healthy host', async () => {
    const fetchImpl = vi.fn(() => ok());
    expect(await checkConnection(BASE, { fetchImpl })).toEqual({ ok: true, url: `${BASE}/api/health`, status: 200 });
  });

  test('a different app answering /api/health (e.g. a model service) is not the AgriSense backend', async () => {
    const fetchImpl = vi.fn(() => ok(200, { status: 'ok', model: 'model/best.pt', imgsz: 640, classes: ['pests'] }));
    const r = await checkConnection(BASE, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.cause).toBe('not_agrisense');
    expect(r.message).toContain('model/best.pt');
  });

  test('timeout', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(Object.assign(new Error('t'), { name: 'TimeoutError' })));
    const r = await checkConnection(BASE, { fetchImpl });
    expect(r.cause).toBe('timeout');
    expect(r.message).toContain(`${BASE}/api/health`);
  });

  test('connection refused: both the normal and the no-cors request fail', async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    const r = await checkConnection(BASE, { fetchImpl });
    expect(r.cause).toBe('connection_refused');
    expect(fetchImpl.mock.calls[1][1].mode).toBe('no-cors');
  });

  test('CORS: the normal request fails but an opaque no-cors reply comes back', async () => {
    const fetchImpl = vi.fn((_url, opts) => (opts.mode === 'no-cors' ? Promise.resolve({ type: 'opaque', status: 0 }) : Promise.reject(new TypeError('Failed to fetch'))));
    const r = await checkConnection(BASE, { fetchImpl });
    expect(r.cause).toBe('cors');
    expect(r.message).toMatch(/CORS_ORIGINS/);
  });

  test('404 on /api/health falls back to /api/, then reports not found', async () => {
    const fetchImpl = vi.fn(() => ok(404));
    const r = await checkConnection(BASE, { fetchImpl });
    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([`${BASE}/api/health`, `${BASE}/api/`]);
    expect(r.cause).toBe('not_found');
  });

  test('404 on /health but /api/ answers counts as reachable', async () => {
    const fetchImpl = vi.fn((url) => ok(url.endsWith('/health') ? 404 : 200));
    expect((await checkConnection(BASE, { fetchImpl })).ok).toBe(true);
  });

  test('wrong protocol: https base for a plain-http host, or an https page calling http', async () => {
    const fetchImpl = vi.fn();
    expect((await checkConnection('https://10.193.42.16:5173', { fetchImpl })).cause).toBe('wrong_protocol');
    expect((await checkConnection(BASE, { fetchImpl, pageProtocol: 'https:' })).cause).toBe('wrong_protocol');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test('other HTTP errors are reported with their status', async () => {
    const r = await checkConnection(BASE, { fetchImpl: vi.fn(() => ok(502)) });
    expect(r.cause).toBe('http_error');
    expect(r.message).toContain('HTTP 502');
  });
});
