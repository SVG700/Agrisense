/**
 * Telemetry routes
 *   POST /api/telemetry          ingest a capture (device auth, idempotent via capture_id)
 *   GET  /api/telemetry          history page (oldest-first) with detections joined
 *   GET  /api/telemetry/latest   most recent capture for a device
 *
 * Ingestion order: validate -> idempotency check -> image upload -> vision ->
 * advisory -> ONE atomic DB write. A failed AI provider never discards a valid
 * capture: it is saved with an explicit failed/fallback status instead.
 */
import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { DEMO_DEVICE_ID } from '../config.js';
import { requireDevice } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { dailySeries, evaluateDecision, splitCounts, withTrapCheck } from '../services/decision.js';
import {
  HttpError,
  batteryLevel,
  decodeImage,
  isUuid,
  optionalImageUrl,
  optionalReading,
  parseTimestamp,
  requireUuid,
  statusForBattery,
} from '../utils/validate.js';

/** Who produced the sensor readings (labelled so mock data is never mistaken for real data). */
const DATA_SOURCES = ['hardware', 'simulator', 'dashboard', 'unknown'];

const totalOf = (counts) => Object.values(counts ?? {}).reduce((a, b) => a + b, 0);

/** Detection data usable for trends: real or simulated counts (legacy rows have no vision_meta). */
const hasCounts = (det) => det && ['ok', 'simulated', undefined].includes(det.vision_meta?.status);

function skippedAdvisory(vision) {
  const reasons = {
    failed: `Pest detection failed (${vision.error?.code ?? 'error'}), so no advisory was generated. The capture and sensor readings were saved.`,
    not_configured: 'No vision provider is configured, so insects in this image were not counted and no advisory was generated.',
    skipped: 'This capture had no image, so no pest advisory was generated.',
  };
  return {
    risk_level: null,
    confidence: null,
    summary: reasons[vision.status] ?? 'No advisory generated.',
    recommendation: '',
    mitigation_strategy: [],
    source: 'none',
    status: 'skipped',
    generated_at: new Date().toISOString(),
  };
}

function sourcesOf(telemetry, storeKind) {
  const det = telemetry.detection ?? {};
  return {
    vision: det.vision_meta?.status ?? 'unknown',
    advisory: det.ai_advisory?.source ?? 'unknown',
    advisory_status: det.ai_advisory?.status ?? 'unknown',
    store: storeKind,
  };
}

export function telemetryRouter({ config, store, vision, advisor, logger }) {
  const router = Router();

  router.post(
    '/',
    rateLimit({ name: 'ingest', windowMs: config.rateLimit.windowMs, max: config.rateLimit.ingestMax }),
    requireDevice(config),
    async (req, res) => {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be a JSON object', { code: 'invalid_body' });
      }

      // ---- 1. Validate (no clamping: invalid readings are rejected) ---------------
      const boundDevice = req.auth?.deviceId ?? null;
      const deviceId =
        body.device_id === undefined ? boundDevice ?? DEMO_DEVICE_ID : requireUuid(body.device_id, 'device_id');
      if (boundDevice && deviceId !== boundDevice) {
        throw new HttpError(403, 'This device key may only submit data for its own device', { code: 'device_mismatch' });
      }
      const clientCaptureId = body.capture_id !== undefined;
      const captureId = clientCaptureId ? requireUuid(body.capture_id, 'capture_id') : randomUUID();
      const temperature = optionalReading(body.temperature, 'temperature');
      const humidity = optionalReading(body.humidity, 'humidity');
      const timestamp = parseTimestamp(body.timestamp);
      const battery = body.battery_level === undefined ? undefined : batteryLevel(body.battery_level);
      const dataSource = body.data_source ?? 'unknown';
      if (!DATA_SOURCES.includes(dataSource)) {
        throw new HttpError(400, `"data_source" must be one of: ${DATA_SOURCES.join(', ')}`, { code: 'invalid_data_source' });
      }

      if (body.image_url && body.image_base64) {
        throw new HttpError(400, 'Send either image_url or image_base64, not both', { code: 'ambiguous_image' });
      }
      const imageUrl = optionalImageUrl(body.image_url);
      const image = body.image_base64 != null ? decodeImage(body.image_base64, config.maxImageBytes) : null;
      if (!imageUrl && !image && temperature === null && humidity === null) {
        throw new HttpError(422, 'A capture needs an image or at least one sensor reading', { code: 'empty_capture' });
      }

      // ---- 2. Idempotency: a retried capture returns the stored result ------------
      if (clientCaptureId) {
        const existing = await store.findCapture(captureId);
        if (existing) {
          if (existing.device_id !== deviceId) {
            throw new HttpError(409, 'capture_id already used by another device', { code: 'capture_id_conflict' });
          }
          return res.status(200).json({ telemetry: existing, duplicate: true, sources: sourcesOf(existing, store.kind) });
        }
      }

      const device = await store.ensureDevice(deviceId, `Trap ${deviceId.slice(0, 8)}`);
      if (battery !== undefined) {
        await store.updateDevice(deviceId, {
          battery_level: battery,
          status: statusForBattery(battery),
          battery_source: 'device',
          battery_updated_at: new Date().toISOString(),
        });
      }

      // ---- 3. Image storage (failure -> nothing saved, client retries) ------------
      let stored = { image_url: imageUrl, image_path: null };
      if (image) {
        try {
          stored = await store.uploadImage({
            path: `captures/${deviceId}/${captureId}.${image.ext}`,
            buffer: image.buffer,
            contentType: image.contentType,
          });
        } catch (err) {
          logger.error('image_upload_failed', { capture_id: captureId, error: err.message, cause: err.cause?.message });
          throw new HttpError(502, 'Image upload failed; nothing was saved. Retry later.', { code: 'image_upload_failed' });
        }
      }

      // ---- 4. Vision -------------------------------------------------------------
      const result = await vision.detect({ imageUrl, image });

      // ---- 5. Predator-aware decision (history + this capture), then the advisory --
      const recent = await store.listTelemetry({ deviceId, limit: 200, sign: false });
      const days = dailySeries(recent);
      const counted = result.boxes.filter((b) => b.confidence >= config.vision.minConfidence);
      const confs = counted.map((b) => b.confidence);
      const meanConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
      if (result.counts) {
        // The entry for today is the larger of any earlier capture today and this one
        const today = timestamp.slice(0, 10);
        const { pests, predators } = splitCounts(result.counts);
        const prev = days.find((d) => d.date === today);
        if (!prev) days.push({ date: today, pests, predators, confidence: meanConfidence });
        else if (pests > prev.pests) Object.assign(prev, { pests, predators, confidence: meanConfidence });
      }
      const decision = withTrapCheck(evaluateDecision(days), { status: result.status, timestamp });

      let advisory;
      if (result.counts) {
        const history = recent
          .slice(-6)
          .filter((t) => hasCounts(t.detection))
          .map((t) => ({
            time: t.timestamp,
            total: totalOf(t.detection.pest_counts),
            temperature: t.temperature,
            humidity: t.humidity,
          }));
        advisory = await advisor.generate({
          capture_time: timestamp,
          device_name: device?.name ?? deviceId,
          pest_counts: result.counts,
          temperature,
          humidity,
          history,
          decision,
          detection: {
            simulated: result.status === 'simulated',
            counted: counted.length,
            threshold: config.vision.minConfidence,
            mean_confidence: confs.length ? Number((confs.reduce((a, b) => a + b, 0) / confs.length).toFixed(3)) : null,
            min_confidence: confs.length ? Math.min(...confs) : null,
          },
        });
      } else {
        advisory = skippedAdvisory(result);
      }
      // The rule-based decision travels with the advisory that explains it
      advisory = { ...advisory, decision };

      // ---- 6. Atomic persist -------------------------------------------------------
      const { telemetry, duplicate } = await store.ingestCapture({
        telemetry: {
          device_id: deviceId,
          capture_id: captureId,
          timestamp,
          temperature,
          humidity,
          image_url: stored.image_path ? null : stored.image_url,
          image_path: stored.image_path,
          data_source: dataSource,
        },
        detection: {
          pest_counts: result.counts ?? {},
          bounding_boxes: result.boxes,
          ai_advisory: advisory,
          vision_meta: {
            status: result.status,
            source: result.source,
            provider: result.provider,
            model: result.model,
            image: result.image,
            rejected: result.rejected,
            error: result.error,
            latency_ms: result.latency_ms ?? null,
          },
        },
      });

      logger.info('capture_ingested', {
        request_id: req.id,
        capture_id: captureId,
        device_id: deviceId,
        vision: result.status,
        advisory: `${advisory.source}/${advisory.status}`,
        duplicate,
      });
      res.status(duplicate ? 200 : 201).json({ telemetry, duplicate, sources: sourcesOf(telemetry, store.kind) });
    }
  );

  const parseQuery = (req) => {
    const { device_id: deviceId, before } = req.query;
    if (deviceId !== undefined && !isUuid(deviceId)) {
      throw new HttpError(400, '"device_id" must be a UUID', { code: 'invalid_device_id' });
    }
    if (before !== undefined && Number.isNaN(new Date(before).getTime())) {
      throw new HttpError(400, '"before" must be an ISO-8601 date', { code: 'invalid_before' });
    }
    const limit = Math.min(500, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    return { deviceId, limit, before: before ? new Date(before).toISOString() : undefined };
  };

  router.get('/', async (req, res) => {
    res.json(await store.listTelemetry(parseQuery(req)));
  });

  router.get('/latest', async (req, res) => {
    const { deviceId } = parseQuery(req);
    const [latest] = await store.listTelemetry({ deviceId, limit: 1 });
    if (!latest) throw new HttpError(404, 'No telemetry yet', { code: 'no_telemetry' });
    res.json(latest);
  });

  return router;
}
