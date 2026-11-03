/**
 * Vision layer: trap image -> validated bounding boxes + per-species counts.
 *
 * Result states (stored in pest_detections.vision_meta.status):
 *   ok             real provider responded (zero detections is a valid result)
 *   simulated      synthetic demo trap (/api/mock-trap/...) - boxes are generated, not inferred
 *   failed         provider configured but the call/response failed - NO detections are invented
 *   not_configured real image but no provider configured - no detections
 *   skipped        capture had no image
 *
 * Providers:
 *   roboflow  POST {YOLO_API_URL}  (e.g. https://serverless.roboflow.com/<project>/<version>)
 *             Authorization: Bearer <key>; image URL via ?image=, or base64 body
 *             (application/x-www-form-urlencoded). Response: {image:{width,height}, predictions:[{x,y,width,height,class,confidence}]}
 *             where x/y are box CENTRES in pixels.
 *   generic   POST JSON {image_url} | {image_base64, content_type}; response
 *             {detections:[{label, confidence, bbox:[x1,y1,x2,y2]}], image_width?, image_height?}
 */
import axios from 'axios';
import { generateTrap, parseMockTrapUrl, SPECIES, TRAP_HEIGHT, TRAP_WIDTH } from './mockTrap.js';

class InvalidResponseError extends Error {}

const LABEL_RE = /^[a-z0-9][a-z0-9 _-]{0,63}$/i;

/** Normalizes a provider label to snake_case ("Fungus Gnat" -> "fungus_gnat"). */
const normLabel = (l) => String(l).trim().toLowerCase().replace(/[\s-]+/g, '_');

/**
 * Converts one candidate box (normalized 0..1 corner form) into our schema,
 * or returns null if it is unusable. Boxes partly outside the frame are clipped.
 */
function finalizeBox({ label, confidence, x1, y1, x2, y2 }) {
  if (![confidence, x1, y1, x2, y2].every(Number.isFinite)) return null;
  if (typeof label !== 'string' || !LABEL_RE.test(label.trim())) return null;
  if (confidence < 0 || confidence > 1) return null;
  if (x2 <= x1 || y2 <= y1) return null;
  // Entirely outside the image, or absurdly larger than it -> reject
  if (x2 <= 0 || y2 <= 0 || x1 >= 1 || y1 >= 1) return null;
  if (x2 - x1 > 1.05 || y2 - y1 > 1.05) return null;

  const cx1 = Math.max(0, x1);
  const cy1 = Math.max(0, y1);
  const cx2 = Math.min(1, x2);
  const cy2 = Math.min(1, y2);
  const r = (n) => Math.round(n * 1e5) / 1e5;
  return {
    label: normLabel(label),
    confidence: Math.round(confidence * 1000) / 1000,
    x: r(cx1),
    y: r(cy1),
    width: r(cx2 - cx1),
    height: r(cy2 - cy1),
  };
}

/** Parses + validates a provider response. Throws InvalidResponseError on bad shape. */
export function normalizeResponse(provider, data) {
  const boxes = [];
  let rejected = 0;
  let image = null;
  const push = (candidate) => {
    const box = finalizeBox(candidate);
    box ? boxes.push(box) : rejected++;
  };

  if (provider === 'roboflow') {
    const W = Number(data?.image?.width);
    const H = Number(data?.image?.height);
    if (!Array.isArray(data?.predictions)) throw new InvalidResponseError('missing "predictions" array');
    if (!(W > 0 && H > 0)) throw new InvalidResponseError('missing or invalid image dimensions');
    image = { width: W, height: H };
    for (const p of data.predictions) {
      const [x, y, w, h] = [p?.x, p?.y, p?.width, p?.height].map(Number);
      push({
        label: p?.class,
        confidence: Number(p?.confidence),
        x1: (x - w / 2) / W,
        y1: (y - h / 2) / H,
        x2: (x + w / 2) / W,
        y2: (y + h / 2) / H,
      });
    }
  } else {
    if (!Array.isArray(data?.detections)) throw new InvalidResponseError('missing "detections" array');
    const W = Number(data.image_width);
    const H = Number(data.image_height);
    const pixels = W > 0 && H > 0;
    if (pixels) image = { width: W, height: H };
    for (const d of data.detections) {
      const bbox = Array.isArray(d?.bbox) && d.bbox.length === 4 ? d.bbox.map(Number) : [NaN, NaN, NaN, NaN];
      const [x1, y1, x2, y2] = pixels ? [bbox[0] / W, bbox[1] / H, bbox[2] / W, bbox[3] / H] : bbox;
      // Without image dimensions, coordinates must already be normalized
      if (!pixels && bbox.some((v) => v > 1.5)) {
        rejected++;
        continue;
      }
      push({ label: d?.label ?? d?.class, confidence: Number(d?.confidence ?? d?.score), x1, y1, x2, y2 });
    }
  }
  return { boxes, rejected, image };
}

/** {"aphid": 12, ...} from boxes at/above the confidence threshold. Known species always present. */
export function countPests(boxes, minConfidence = 0.5) {
  const counts = Object.fromEntries(Object.keys(SPECIES).map((k) => [k, 0]));
  for (const b of boxes) {
    if (b.confidence < minConfidence) continue;
    counts[b.label] = (counts[b.label] ?? 0) + 1;
  }
  return counts;
}

function errorInfo(err) {
  if (err instanceof InvalidResponseError) return { code: 'invalid_response', message: err.message };
  if (err?.code === 'ECONNABORTED' || err?.code === 'ETIMEDOUT' || err?.name === 'CanceledError') {
    return { code: 'timeout', message: 'Vision provider timed out' };
  }
  if (err?.response) return { code: `http_${err.response.status}`, message: `Vision provider returned HTTP ${err.response.status}` };
  return { code: 'network_error', message: 'Could not reach the vision provider' };
}

/**
 * @param {{config: object, http?: import('axios').AxiosInstance, logger?: object}} deps
 */
export function createVision({ config, http = axios, logger }) {
  const v = config.vision;
  const configured = Boolean(v.url);

  async function callProvider({ imageUrl, image }) {
    const headers = {};
    if (v.apiKey) headers.Authorization = `Bearer ${v.apiKey}`;
    const opts = { headers, timeout: v.timeoutMs, maxContentLength: 5 * 1024 * 1024 };

    if (v.provider === 'roboflow') {
      if (image) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        return (await http.post(v.url, image.buffer.toString('base64'), opts)).data;
      }
      return (await http.post(v.url, null, { ...opts, params: { image: imageUrl } })).data;
    }
    headers['Content-Type'] = 'application/json';
    const body = image
      ? { image_base64: image.buffer.toString('base64'), content_type: image.contentType }
      : { image_url: imageUrl };
    return (await http.post(v.url, body, opts)).data;
  }

  return {
    describe: () => ({
      state: configured ? 'configured' : 'not_configured',
      provider: configured ? v.provider : null,
      model: configured ? v.modelId || null : null,
    }),

    /**
     * @param {{imageUrl?: string|null, image?: {buffer: Buffer, contentType: string}|null}} input
     */
    async detect({ imageUrl, image }) {
      const base = { boxes: [], counts: null, image: null, rejected: 0, error: null, provider: null, model: null };

      if (!imageUrl && !image) return { ...base, status: 'skipped', source: 'none' };

      // Synthetic demo traps: simulated detections that match the rendered SVG
      const mock = !image && parseMockTrapUrl(imageUrl);
      if (mock) {
        const boxes = generateTrap(mock.seed, mock.density, mock.opts).map(({ label, confidence, x, y, width, height }) => ({
          label,
          confidence,
          x,
          y,
          width,
          height,
        }));
        return {
          ...base,
          status: 'simulated',
          source: 'simulated',
          provider: 'mock-trap',
          model: 'synthetic-v1',
          boxes,
          counts: countPests(boxes, v.minConfidence),
          image: { width: TRAP_WIDTH, height: TRAP_HEIGHT },
        };
      }

      if (!configured) return { ...base, status: 'not_configured', source: 'none' };

      const started = Date.now();
      try {
        const data = await callProvider({ imageUrl, image });
        const { boxes, rejected, image: dims } = normalizeResponse(v.provider, data);
        if (rejected) logger?.warn('vision_boxes_rejected', { rejected, accepted: boxes.length });
        return {
          ...base,
          status: 'ok',
          source: 'yolo',
          provider: v.provider,
          model: v.modelId || data?.resolved_model || null,
          boxes,
          rejected,
          image: dims,
          counts: countPests(boxes, v.minConfidence),
          latency_ms: Date.now() - started,
        };
      } catch (err) {
        const error = errorInfo(err);
        logger?.warn('vision_failed', { code: error.code, provider: v.provider });
        return { ...base, status: 'failed', source: 'yolo', provider: v.provider, model: v.modelId || null, error, latency_ms: Date.now() - started };
      }
    },
  };
}
