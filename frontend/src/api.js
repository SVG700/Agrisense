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

/** Natural (Gemini) voice for a text: resolves to an audio Blob (WAV). */
async function voice(text, lang = 'en', voiceName, signal) {
  let res;
  try {
    res = await fetch(`${BASE}/api/voice`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang, ...(voiceName ? { voice: voiceName } : {}) }) });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach the Agrisense API - is the backend running?');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(data.error ?? `Voice failed (${res.status})`, { status: res.status, code: data.code ?? 'http_error' });
  }
  return res.blob();
}

export const api = {
  health: () => request('/api/health'),
  voice,
  voices: () => request('/api/voice'),
  // Economic impact of a trap's current decision (estimate) + crop presets
  economics: (deviceId, s = {}) => {
    const q = new URLSearchParams({ device_id: deviceId });
    for (const [k, v] of Object.entries(s)) if (v !== undefined && v !== null && v !== '') q.set(k, v);
    return request(`/api/economics?${q}`);
  },
  crops: () => request('/api/economics/crops'),
  // Live weather at a place (null = the farm's default location) and place search
  weatherNow: (p) =>
    request(p ? `/api/weather/now?lat=${p.lat}&lon=${p.lon}&label=${encodeURIComponent(p.label ?? '')}` : '/api/weather/now'),
  places: (q) => request(`/api/places?q=${encodeURIComponent(q)}`),
  placeName: (lat, lon) => request(`/api/places/reverse?lat=${lat}&lon=${lon}`),
  devices: () => request('/api/devices'),
  telemetry: (deviceId, limit = 50) =>
    request(`/api/telemetry?limit=${limit}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`),
  decision: (deviceId) => request(`/api/decision?device_id=${encodeURIComponent(deviceId)}`),
  mapData: (days = 14) => request(`/api/map-data?days=${encodeURIComponent(days)}`),
  actions: (deviceId, limit = 50) => request(`/api/actions?device_id=${encodeURIComponent(deviceId)}&limit=${limit}`),
  logAction: (payload) => request('/api/actions', { method: 'POST', body: payload, admin: true }),
  deleteAction: (id) => request(`/api/actions/${encodeURIComponent(id)}`, { method: 'DELETE', admin: true }),
  impact: (days = 30) => request(`/api/impact?days=${encodeURIComponent(days)}`),
  simulate: ({ pests, predators, confidence }) =>
    request(`/api/decision/simulate?pests=${pests}&predators=${predators}${confidence != null ? `&confidence=${confidence}` : ''}`),
  decisionRegions: (maxPests = 150, maxPredators = 30, steps = 50) =>
    request(`/api/decision/regions?max_pests=${maxPests}&max_predators=${maxPredators}&steps=${steps}`),
  weather: (deviceId) => request(`/api/weather${deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : ''}`),
  check: (payload) => request('/api/check', { method: 'POST', body: payload }),
  telegramStatus: () => request('/api/admin/telegram', { admin: true }),
  telegramPreview: () => request('/api/admin/telegram/preview', { admin: true }),
  telegramTest: () => request('/api/admin/telegram/test', { method: 'POST', admin: true }),
  telegramSummary: () => request('/api/admin/telegram/summary', { method: 'POST', admin: true }),
  telegramChats: () => request('/api/admin/telegram/chats', { admin: true }),
  telegramBot: () => request('/api/admin/telegram/bot', { admin: true }),
  setTelegramBot: (enabled) => request('/api/admin/telegram/bot', { method: 'POST', body: { enabled }, admin: true }),
  resetDemo: () => request('/api/admin/demo/reset', { method: 'POST', admin: true }),
  clearDemo: () => request('/api/admin/demo', { method: 'DELETE', admin: true }),
  // Trap-box hardware (fan, trap light, Raspberry Pi)
  controls: (deviceId) => request(`/api/devices/${encodeURIComponent(deviceId)}/controls`),
  setControls: (deviceId, patch) => request(`/api/devices/${encodeURIComponent(deviceId)}/controls`, { method: 'PATCH', body: patch, admin: true }),
  sendCommand: (deviceId, command) =>
    request(`/api/devices/${encodeURIComponent(deviceId)}/commands`, { method: 'POST', body: { command }, admin: true }),
  visionFrame: (deviceId) => request(`/api/devices/${encodeURIComponent(deviceId)}/vision/frame`),
  createDevice: (name) => request('/api/devices', { method: 'POST', body: { name }, admin: true }),
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
