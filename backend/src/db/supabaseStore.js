/**
 * Supabase-backed store (PostgreSQL tables + private Storage bucket).
 * Requires supabase/schema.sql (v2) to have been applied.
 *
 * Every DB failure is raised as StoreError so the API answers 503 and the
 * edge device retries later (captures are idempotent via capture_id).
 */
import { createClient } from '@supabase/supabase-js';
import { StoreError } from '../utils/validate.js';

export function createSupabaseStore({ config, client, logger }) {
  const supabase =
    client ??
    createClient(config.supabase.url, config.supabase.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const bucket = config.supabase.bucket;
  const ttl = config.supabase.signedUrlTtlSec;

  /** Unwraps a Supabase response or throws StoreError (message is logged, not returned to clients). */
  async function run(operation, promise) {
    let result;
    try {
      result = await promise;
    } catch (cause) {
      throw new StoreError(operation, cause);
    }
    if (result.error) throw new StoreError(operation, new Error(result.error.message));
    return result.data;
  }

  /** PostgREST embeds 1:1 relations as an object and 1:N as an array. */
  const firstDetection = (d) => (Array.isArray(d) ? d[0] ?? null : d ?? null);

  /** Replaces storage paths with short-lived signed URLs. Never fails the request. */
  async function signImages(rows) {
    const paths = [...new Set(rows.map((r) => r.image_path).filter(Boolean))];
    if (!paths.length) return rows;
    try {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, ttl);
      if (error) throw new Error(error.message);
      const byPath = new Map(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
      return rows.map((r) => (r.image_path ? { ...r, image_url: byPath.get(r.image_path) ?? null } : r));
    } catch (err) {
      logger?.warn('signed_url_failed', { error: err.message });
      return rows.map((r) => (r.image_path ? { ...r, image_url: null } : r));
    }
  }

  const store = {
    kind: 'supabase',

    /**
     * Real GET (not HEAD): a HEAD request against a missing table can come back
     * without an error, which made readiness report "ready" on an empty project.
     * Also checks the v2 schema (capture_id) so a stale schema is reported, not hidden.
     */
    async ping() {
      await run('ping', supabase.from('devices').select('id').limit(1));
      await run('ping_schema', supabase.from('sensor_telemetry').select('capture_id').limit(1));
      return true;
    },

    async listDevices() {
      return run('listDevices', supabase.from('devices').select('*').order('created_at', { ascending: true }));
    },

    async getDevice(id) {
      return run('getDevice', supabase.from('devices').select('*').eq('id', id).maybeSingle());
    },

    /** Insert-if-missing; safe under concurrent first captures from the same device. */
    async ensureDevice(id, name) {
      await run(
        'ensureDevice',
        supabase.from('devices').upsert({ id, name }, { onConflict: 'id', ignoreDuplicates: true })
      );
      return store.getDevice(id);
    },

    async createDevice({ name }) {
      return run('createDevice', supabase.from('devices').insert({ name }).select().single());
    },

    async updateDevice(id, patch) {
      return run(
        'updateDevice',
        supabase
          .from('devices')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select()
          .maybeSingle()
      );
    },

    async findCapture(captureId) {
      const row = await run(
        'findCapture',
        supabase.from('sensor_telemetry').select('*, pest_detections(*)').eq('capture_id', captureId).maybeSingle()
      );
      if (!row) return null;
      const { pest_detections, ...t } = row;
      const [signed] = await signImages([{ ...t, detection: firstDetection(pest_detections) }]);
      return signed;
    },

    /** Telemetry + detection in one DB transaction (ingest_capture RPC). */
    async ingestCapture({ telemetry, detection }) {
      const data = await run(
        'ingestCapture',
        supabase.rpc('ingest_capture', { p_telemetry: telemetry, p_detection: detection })
      );
      const [signed] = await signImages([{ ...data.telemetry, detection: data.detection }]);
      return { telemetry: signed, duplicate: Boolean(data.duplicate) };
    },

    /** Oldest-first page of history; `before` (ISO) pages further back. */
    async listTelemetry({ deviceId, limit = 50, before }) {
      let query = supabase
        .from('sensor_telemetry')
        .select('*, pest_detections(*)')
        .order('timestamp', { ascending: false })
        .limit(limit);
      if (deviceId) query = query.eq('device_id', deviceId);
      if (before) query = query.lt('timestamp', before);
      const rows = await run('listTelemetry', query);
      const flat = rows.reverse().map(({ pest_detections, ...t }) => ({ ...t, detection: firstDetection(pest_detections) }));
      return signImages(flat);
    },

    /** Deterministic path (one object per capture_id) so retries overwrite instead of duplicating. */
    async uploadImage({ path, buffer, contentType }) {
      await run(
        'uploadImage',
        supabase.storage.from(bucket).upload(path, buffer, { contentType, upsert: true })
      );
      return { image_path: path, image_url: null };
    },
  };
  return store;
}
