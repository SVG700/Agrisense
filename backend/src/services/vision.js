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
 *   roboflow  POST {url}?api_key=<ROBOFLOW_API_KEY>  (default https://serverless.roboflow.com/yellow-sticky-traps-bwxut-ieond/1)
 *             image URL via ?image=, or base64 body. Uploaded photos are sliced into
 *             VISION_TILES x VISION_TILES overlapping tiles (services/tiling.js); each tile is
 *             detected, boxes are mapped back to the whole photo and de-duplicated.
 *             Labels (WF/MR/NC...) are mapped to class ids via backend/config/pests.json.
 *             (application/x-www-form-urlencoded). Response: {image:{width,height}, predictions:[{x,y,width,height,class,confidence}]}
 *             where x/y are box CENTRES in pixels.
 *   generic   POST JSON {image_url} | {image_base64, content_type}; response
 *             {detections:[{label, confidence, bbox:[x1,y1,x2,y2]}], image_width?, image_height?}
 *
 * Demo fallback (VISION_DEMO_FALLBACK, default on): with no key, or when the
 * provider fails, a real photo is counted by the labelled "demo-detector"
 * (status simulated; vision_meta.fallback says why). Those counts are generated,
 * so no boxes are drawn over the real photo. VISION_DEMO_FALLBACK=false reports
 * failed / not_configured instead (the trap then shows CHECK TRAP).
 */
import axios from 'axios';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { annotateImage } from './annotate.js';
import { assessQuality } from './imageQuality.js';
import { splitCounts } from './decision.js';
import { generateTrap, parseMockTrapUrl, SPECIES, TRAP_HEIGHT, TRAP_WIDTH } from './mockTrap.js';
import { canonicalLabel, classIdsOfGroup } from './pestConfig.js';
import { dedupeBoxes, mapLimit, mapTileBox, tileGrid } from './tiling.js';

/** Classes the default Roboflow sticky-trap model reports (always listed, even at 0). */
const ROBOFLOW_CLASSES = ['whitefly', 'macrolophus', 'nesidiocoris'];
const TILE_CONCURRENCY = 4;
// Tiles are never smaller than the model's input size: smaller tiles would only be upscaled
const MIN_TILE_SIDE = 640;
// Longest side of any image sent to the provider
const MAX_SEND_SIDE = 1280;

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
    label: canonicalLabel(normLabel(label)),
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
export function countPests(boxes, minConfidence = 0.5, known = Object.keys(SPECIES)) {
  const counts = Object.fromEntries(known.map((k) => [k, 0]));
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
  // sharp could not decode the photo (corrupt / unsupported) while tiling
  if (!err?.request && /input buffer|unsupported image|corrupt|vips|bad seek|premature end/i.test(String(err?.message))) {
    return { code: 'image_unreadable', message: 'The photo could not be decoded' };
  }
  return { code: 'network_error', message: 'Could not reach the vision provider' };
}

/**
 * @param {{config: object, http?: import('axios').AxiosInstance, logger?: object}} deps
 */
export function createVision({ config, http = axios, logger }) {
  const v = config.vision;
  const configured = Boolean(v.url);

  // Species always listed in the counts (even at 0): the model group's classes from config/pests.json when set
  const known = v.classGroup ? classIdsOfGroup(v.classGroup) : v.provider === 'roboflow' ? ROBOFLOW_CLASSES : Object.keys(SPECIES);
  const tiled = v.provider === 'roboflow' && v.tiles > 1;

  async function callProvider({ imageUrl, image }) {
    const headers = {};
    const opts = { headers, timeout: v.timeoutMs, maxContentLength: 5 * 1024 * 1024 };

    if (v.provider === 'roboflow') {
      // Roboflow's hosted API takes the key as a query parameter. It is never logged:
      // failures are reduced to a code by errorInfo() before anything is written.
      const params = { api_key: v.apiKey };
      if (image) {
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        return (await http.post(v.url, image.buffer.toString('base64'), { ...opts, params })).data;
      }
      return (await http.post(v.url, null, { ...opts, params: { ...params, image: imageUrl } })).data;
    }
    if (v.apiKey) headers.Authorization = `Bearer ${v.apiKey}`;
    headers['Content-Type'] = 'application/json';
    const body = image
      ? { image_base64: image.buffer.toString('base64'), content_type: image.contentType }
      : { image_url: imageUrl };
    return (await http.post(v.url, body, opts)).data;
  }

  /**
   * Uploaded photo -> SAHI: one full-image pass + overlapping tiles, boxes mapped
   * to the whole photo and merged. The full pass keeps insects the model only
   * recognises at whole-card scale; the tiles find the tiny ones. Tiles are
   * never smaller than the model input (fewer tiles on smaller photos).
   */
  async function detectTiled(image) {
    const rotated = await sharp(image.buffer, { failOn: 'error' }).rotate().toBuffer({ resolveWithObject: true });
    const { width: W, height: H } = rotated.info;
    const n = Math.max(1, Math.min(v.tiles, Math.floor(Math.max(W, H) / MIN_TILE_SIDE)));
    const tiles = n > 1 ? [{ left: 0, top: 0, width: W, height: H, full: true }, ...tileGrid(W, H, n, v.tileOverlap)] : [{ left: 0, top: 0, width: W, height: H, full: true }];
    let rejected = 0;
    const perTile = await mapLimit(tiles, TILE_CONCURRENCY, async (tile) => {
      // The model sees 640 px anyway: sending at most 1280 px keeps uploads small (boxes are relative, so no accuracy loss)
      let img = sharp(rotated.data);
      if (!tile.full) img = img.extract({ left: tile.left, top: tile.top, width: tile.width, height: tile.height });
      const crop = await img
        .resize({ width: MAX_SEND_SIDE, height: MAX_SEND_SIDE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
      const res = normalizeResponse('roboflow', await callProvider({ image: { buffer: crop, contentType: 'image/jpeg' } }));
      rejected += res.rejected;
      return res.boxes.map((b) => mapTileBox(b, tile, W, H));
    });
    return { boxes: dedupeBoxes(perTile.flat()), rejected, image: { width: W, height: H, tiles: n * n, grid: `${n}x${n}` } };
  }

  /** Labelled demo-detector counts for a real photo the model could not read. */
  function demoFallback({ imageUrl, image }, reason, error = null) {
    const seed = createHash('sha1').update(image ? image.buffer : String(imageUrl)).digest('hex').slice(0, 16);
    const counts = countPests(generateTrap(seed, 0.55, { mix: 'wf', predators: 0.1 }), v.minConfidence, ROBOFLOW_CLASSES);
    return {
      boxes: [],
      counts,
      image: null,
      rejected: 0,
      status: 'simulated',
      source: 'simulated',
      provider: 'demo-detector',
      model: 'synthetic-v1',
      error: null,
      fallback: {
        reason,
        error,
        message: 'The real model was unavailable, so these counts are SIMULATED by the demo detector, not read from this photo.',
      },
    };
  }

  /** Adds totals and (for uploaded photos) an annotated JPEG. Annotation never fails a detection. */
  async function finish(result, image) {
    const out = { ...result, totals: result.counts ? splitCounts(result.counts) : null };
    if (!image) return out;
    try {
      const banner = result.fallback
        ? 'DEMO DETECTOR - counts simulated, not read from this photo'
        : result.quality && !result.quality.ok
          ? `CHECK TRAP - photo ${result.quality.issues.join(', ')}: retake it`
          : undefined;
      return { ...out, annotated_image: await annotateImage(image.buffer, result.boxes, { banner }) };
    } catch (err) {
      logger?.warn('annotate_failed', { error: err.message });
      return out;
    }
  }

  return {
    /** Counting threshold of this instance (phone photos may use a different model and threshold). */
    minConfidence: v.minConfidence,
    describe: () => ({
      state: configured ? 'configured' : 'not_configured',
      provider: configured ? v.provider : null,
      model: configured ? v.modelId || null : null,
      key: configured ? v.keySource ?? null : null, // env var NAME only, never the value
      tiles: configured && tiled ? `${v.tiles}x${v.tiles}` : null,
      demo_fallback: Boolean(v.demoFallback),
      quality_check: Boolean(v.qualityCheck),
    }),

    /**
     * @param {{imageUrl?: string|null, image?: {buffer: Buffer, contentType: string}|null}} input
     * @returns result with status, boxes, counts ({class: n}), totals ({pests, predators}),
     *          and annotated_image (data URL) when an image buffer was given
     */
    async detect({ imageUrl, image }) {
      const base = { boxes: [], counts: null, image: null, rejected: 0, error: null, provider: null, model: null };

      if (!imageUrl && !image) return { ...base, status: 'skipped', source: 'none', totals: null };

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
        return finish({
          ...base,
          status: 'simulated',
          source: 'simulated',
          provider: 'mock-trap',
          model: 'synthetic-v1',
          boxes,
          counts: countPests(boxes, v.minConfidence),
          image: { width: TRAP_WIDTH, height: TRAP_HEIGHT },
        });
      }

      // Photo quality first: a blurry / dark / overexposed / glary photo is not counted at all
      // (no model call, no demo counts) and the trap shows CHECK TRAP with how to retake it.
      let quality = null;
      if (image && v.qualityCheck) {
        try {
          quality = await assessQuality(image.buffer);
        } catch {
          return finish({ ...base, status: 'failed', source: 'quality', error: { code: 'image_unreadable', message: 'The photo could not be decoded' } });
        }
        if (!quality.ok) {
          return finish(
            { ...base, status: 'failed', source: 'quality', error: { code: 'poor_image', message: quality.reason }, quality },
            image
          );
        }
      }

      if (!configured) {
        const res = v.demoFallback ? demoFallback({ imageUrl, image }, 'not_configured') : { ...base, status: 'not_configured', source: 'none' };
        return finish({ ...res, quality }, image);
      }

      const started = Date.now();
      try {
        let found;
        if (image && tiled) {
          found = await detectTiled(image);
        } else if (image && v.provider === 'generic') {
          // Upright (EXIF) and at most MAX_SEND_SIDE px: keeps the JSON body small; boxes come back
          // relative to this copy, which has the same aspect ratio as the photo the farmer sees.
          const upright = await sharp(image.buffer, { failOn: 'error' })
            .rotate()
            .resize({ width: MAX_SEND_SIDE, height: MAX_SEND_SIDE, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toBuffer();
          const data = await callProvider({ image: { buffer: upright, contentType: 'image/jpeg' } });
          found = { ...normalizeResponse(v.provider, data), resolved: data?.model, experimental: data?.experimental === true };
        } else {
          const data = await callProvider({ imageUrl, image });
          found = { ...normalizeResponse(v.provider, data), resolved: data?.resolved_model };
        }
        if (found.rejected) logger?.warn('vision_boxes_rejected', { rejected: found.rejected, accepted: found.boxes.length });
        return finish(
          {
            ...base,
            status: 'ok',
            source: 'yolo',
            provider: v.provider,
            // generic services report what they actually loaded (e.g. "UNVERIFIED:..." for a wrong model)
            model: (v.provider === 'generic' && found.resolved) || v.modelId || found.resolved || null,
            // the service says its model is experimental (low accuracy): the UI labels every result
            experimental: Boolean(found.experimental),
            boxes: found.boxes,
            rejected: found.rejected,
            image: found.image,
            counts: countPests(found.boxes, v.minConfidence, known),
            latency_ms: Date.now() - started,
            quality,
          },
          image
        );
      } catch (err) {
        const error = errorInfo(err);
        logger?.warn('vision_failed', { code: error.code, provider: v.provider });
        if (v.demoFallback) return finish({ ...demoFallback({ imageUrl, image }, 'failed', error), latency_ms: Date.now() - started, quality }, image);
        return finish({ ...base, status: 'failed', source: 'yolo', provider: v.provider, model: v.modelId || null, error, latency_ms: Date.now() - started });
      }
    },
  };
}
