/**
 * Thin fetch wrapper for the Agrisense API.
 *
 * Errors are thrown as ApiError(message, {status, code}). The admin key is
 * entered by the operator in the Admin tab and kept in sessionStorage only -
 * it is never part of the build (no VITE_* secret).
 */
const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const ADMIN_KEY_STORAGE = 'agrisense.adminKey';

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'network_error' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function getAdminKey() {
  try {
    return sessionStorage.getItem(ADMIN_KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function setAdminKey(key) {
  try {
    key ? sessionStorage.setItem(ADMIN_KEY_STORAGE, key) : sessionStorage.removeItem(ADMIN_KEY_STORAGE);
  } catch {
    /* storage unavailable (private mode) - key just won't persist */
  }
}

async function request(path, { method = 'GET', body, signal, admin = false } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  const key = admin ? getAdminKey() : '';
  if (key) headers.Authorization = `Bearer ${key}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, { method, signal, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the Agrisense API - is the backend running?');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(data.error ?? `Request failed (${res.status})`, { status: res.status, code: data.code ?? 'http_error' });
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  devices: () => request('/api/devices'),
  telemetry: (deviceId, limit = 50) =>
    request(`/api/telemetry?limit=${limit}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`),
  setBattery: (device_id, battery_level) =>
    request('/api/device/battery', { method: 'PATCH', body: { device_id, battery_level }, admin: true }),
  // Dashboard captures are always labelled as simulated readings
  ingest: (payload) =>
    request('/api/telemetry', { method: 'POST', body: { data_source: 'dashboard', ...payload }, admin: true }),
};

/** Builds a synthetic trap image URL the backend can both render and "detect" (simulated). */
export function mockTrapUrl(density) {
  const origin = BASE || window.location.origin;
  return `${origin}/api/mock-trap/${Date.now().toString(36)}.svg?d=${density.toFixed(2)}`;
}
