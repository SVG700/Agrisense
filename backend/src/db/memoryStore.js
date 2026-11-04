/**
 * In-memory store with the same interface as supabaseStore.js.
 * Used when Supabase is not configured (demo mode). Data is lost on restart.
 * Uploaded images are kept in memory and returned as data URLs (demo only).
 */
import { randomUUID } from 'node:crypto';
import { DEMO_DEVICE_ID } from '../config.js';

const MAX_CAPTURES = 5000; // keep memory bounded during long demos

export function createMemoryStore() {
  const devices = new Map();
  const telemetry = [];
  const detections = new Map(); // telemetry_id -> detection
  const byCaptureId = new Map(); // capture_id -> telemetry
  const images = new Map(); // path -> data URL
  const observations = new Map(); // `${device_id}|${date}` -> trap_daily_observations row
  let telemetrySeq = 1;
  let detectionSeq = 1;
  let observationSeq = 1;
  const actions = []; // trap_actions rows
  let actionSeq = 1;

  const now = () => new Date().toISOString();
  const clone = (o) => structuredClone(o);
  const withDetection = (t) => ({ ...clone(t), detection: clone(detections.get(t.id) ?? null) });

  devices.set(DEMO_DEVICE_ID, {
    id: DEMO_DEVICE_ID,
    name: 'Greenhouse A - Trap 01',
    battery_level: 92,
    status: 'online',
    battery_source: 'unknown',
    battery_updated_at: null,
    created_at: now(),
    updated_at: now(),
  });

  return {
    kind: 'memory',

    async ping() {
      return true;
    },

    async listDevices({ includeSimulated = false } = {}) {
      return [...devices.values()]
        .filter((d) => includeSimulated || d.simulated !== true)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map(clone);
    },

    async upsertDevices(rows) {
      for (const r of rows) {
        const existing = devices.get(r.id);
        devices.set(r.id, {
          battery_level: 100,
          status: 'online',
          battery_source: 'unknown',
          battery_updated_at: null,
          created_at: now(),
          ...existing,
          ...clone(r),
          updated_at: now(),
        });
      }
      return rows.map((r) => clone(devices.get(r.id)));
    },

    async upsertObservations(rows) {
      for (const r of rows) {
        const key = `${r.device_id}|${r.date}`;
        const prev = observations.get(key);
        observations.set(key, { id: prev?.id ?? observationSeq++, created_at: prev?.created_at ?? now(), ...clone(r) });
      }
      return rows.map((r) => ({ id: observations.get(`${r.device_id}|${r.date}`).id }));
    },

    async listObservations({ since, deviceId }) {
      return [...observations.values()].filter((o) => o.date >= since && (!deviceId || o.device_id === deviceId)).sort((a, b) => a.date.localeCompare(b.date)).map(clone);
    },

    async deleteSimulatedDevices() {
      const removed = [...devices.values()].filter((d) => d.simulated === true).map((d) => ({ id: d.id }));
      for (const { id } of removed) {
        devices.delete(id);
        for (const [k, o] of observations) if (o.device_id === id) observations.delete(k);
      }
      return removed;
    },

    /** Removes the given devices with all their captures and observations (demo reset). */
    /** Newest first. */
    async listActions({ deviceId, limit = 50 } = {}) {
      return actions
        .filter((a) => !deviceId || a.device_id === deviceId)
        .sort((a, b) => b.acted_at.localeCompare(a.acted_at) || b.id - a.id)
        .slice(0, limit)
        .map(clone);
    },

    async addActions(rows) {
      const added = rows.map((r) => ({ id: actionSeq++, created_at: now(), note: null, decision: null, ...clone(r) }));
      actions.push(...added);
      return added.map(clone);
    },

    async deleteAction(id) {
      const i = actions.findIndex((a) => a.id === id);
      return i < 0 ? null : clone(actions.splice(i, 1)[0]);
    },

    async deleteDevices(ids) {
      const drop = new Set(ids);
      for (let i = actions.length - 1; i >= 0; i--) if (drop.has(actions[i].device_id)) actions.splice(i, 1);
      const removed = ids.filter((id) => devices.delete(id)).map((id) => ({ id }));
      for (const [k, o] of observations) if (drop.has(o.device_id)) observations.delete(k);
      for (let i = telemetry.length - 1; i >= 0; i--) {
        const t = telemetry[i];
        if (!drop.has(t.device_id)) continue;
        telemetry.splice(i, 1);
        byCaptureId.delete(t.capture_id);
        detections.delete(t.id);
        if (t.image_path) images.delete(t.image_path);
      }
      return removed;
    },

    async getDevice(id) {
      return clone(devices.get(id) ?? null);
    },

    async ensureDevice(id, name) {
      if (!devices.has(id)) {
        devices.set(id, {
          id,
          name,
          battery_level: 100,
          status: 'online',
          battery_source: 'unknown',
          battery_updated_at: null,
          created_at: now(),
          updated_at: now(),
        });
      }
      return clone(devices.get(id));
    },

    async createDevice({ name }) {
      const id = randomUUID();
      return this.ensureDevice(id, name);
    },

    async updateDevice(id, patch) {
      const device = devices.get(id);
      if (!device) return null;
      Object.assign(device, patch, { updated_at: now() });
      return clone(device);
    },

    async findCapture(captureId) {
      const t = byCaptureId.get(captureId);
      return t ? withDetection(t) : null;
    },

    /** Atomic by construction (single-threaded, no awaits between writes). */
    async ingestCapture({ telemetry: tel, detection: det }) {
      const existing = byCaptureId.get(tel.capture_id);
      if (existing) return { telemetry: withDetection(existing), duplicate: true };

      const row = {
        id: telemetrySeq++,
        received_at: now(),
        ...clone(tel),
        image_url: tel.image_path ? images.get(tel.image_path) ?? null : tel.image_url,
      };
      telemetry.push(row);
      byCaptureId.set(row.capture_id, row);
      detections.set(row.id, { id: detectionSeq++, telemetry_id: row.id, created_at: now(), ...clone(det) });

      // Bounded memory: drop the oldest captures
      while (telemetry.length > MAX_CAPTURES) {
        const old = telemetry.shift();
        byCaptureId.delete(old.capture_id);
        detections.delete(old.id);
        if (old.image_path) images.delete(old.image_path);
      }
      return { telemetry: withDetection(row), duplicate: false };
    },

    async listTelemetry({ deviceId, limit = 50, before }) {
      return telemetry
        .filter((t) => (!deviceId || t.device_id === deviceId) && (!before || t.timestamp < before))
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .slice(-limit)
        .map(withDetection);
    },

    async uploadImage({ path, buffer, contentType }) {
      const url = `data:${contentType};base64,${buffer.toString('base64')}`;
      images.set(path, url);
      return { image_path: path, image_url: url };
    },
  };
}
