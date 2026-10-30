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
  let telemetrySeq = 1;
  let detectionSeq = 1;

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

    async listDevices() {
      return [...devices.values()].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(clone);
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
