/**
 * Request validation helpers.
 *
 * Every API error has the shape { error: string, code: string, details? } and
 * is raised as an HttpError. Sensor readings are NOT clamped: missing readings
 * become null (sensor failure) and out-of-range readings are rejected (422).
 */
import { LOW_BATTERY_THRESHOLD, SENSOR_LIMITS } from '../config.js';

export class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   * @param {{code?: string, details?: any}} [opts]
   */
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.status = status;
    this.code = code ?? defaultCode(status);
    this.details = details;
  }
}

function defaultCode(status) {
  return (
    {
      400: 'bad_request',
      401: 'unauthorized',
      403: 'forbidden',
      404: 'not_found',
      409: 'conflict',
      413: 'payload_too_large',
      415: 'unsupported_media_type',
      422: 'validation_failed',
      429: 'rate_limited',
      502: 'upstream_failed',
      503: 'service_unavailable',
    }[status] ?? 'internal_error'
  );
}

/** Raised by stores so routes can map DB failures to 503. */
export class StoreError extends Error {
  constructor(operation, cause) {
    super(`Database operation "${operation}" failed`);
    this.operation = operation;
    this.cause = cause;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function requireUuid(value, field) {
  if (!isUuid(value)) throw new HttpError(400, `"${field}" must be a UUID`, { code: 'invalid_' + field });
  return value.toLowerCase();
}

/**
 * Optional sensor reading: undefined/null -> null (not measured);
 * non-number -> 400; outside physical limits -> 422. Zero is a valid value.
 */
export function optionalReading(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `"${field}" must be a number or null`, { code: 'invalid_' + field });
  }
  const { min, max, unit } = SENSOR_LIMITS[field];
  if (value < min || value > max) {
    throw new HttpError(422, `"${field}" ${value}${unit} is outside the sensor range ${min}..${max}${unit}`, {
      code: 'sensor_out_of_range',
      details: { field, value, min, max },
    });
  }
  return value;
}

/** Battery percentage 0..100 (rounded); out-of-range is rejected, not clamped. */
export function batteryLevel(value, field = 'battery_level') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `"${field}" must be a number`, { code: 'invalid_battery_level' });
  }
  if (value < 0 || value > 100) {
    throw new HttpError(422, `"${field}" must be between 0 and 100`, { code: 'invalid_battery_level' });
  }
  return Math.round(value);
}

export function statusForBattery(level) {
  if (level <= 0) return 'offline';
  if (level < LOW_BATTERY_THRESHOLD) return 'low_battery';
  return 'online';
}

/** Optional ISO timestamp -> UTC ISO string; rejects garbage and future dates. */
export function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return new Date().toISOString();
  if (typeof value !== 'string') throw new HttpError(400, '"timestamp" must be an ISO-8601 string', { code: 'invalid_timestamp' });
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, '"timestamp" must be an ISO-8601 date', { code: 'invalid_timestamp' });
  if (d.getTime() > Date.now() + 5 * 60_000) throw new HttpError(422, '"timestamp" is in the future', { code: 'invalid_timestamp' });
  return d.toISOString();
}

/** Only absolute http(s) URLs, bounded length. */
export function optionalImageUrl(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) {
    throw new HttpError(400, '"image_url" must be a string up to 2048 chars', { code: 'invalid_image_url' });
  }
  try {
    const u = new URL(value.trim());
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
    return u.toString();
  } catch {
    throw new HttpError(400, '"image_url" must be an absolute http(s) URL', { code: 'invalid_image_url' });
  }
}

const SIGNATURES = [
  { type: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/webp', ext: 'webp', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];

/**
 * Decodes raw base64 or a data URL and validates the actual bytes
 * (magic numbers), not the declared type.
 * @returns {{buffer: Buffer, contentType: string, ext: string}}
 */
export function decodeImage(input, maxBytes) {
  if (typeof input !== 'string') throw new HttpError(400, '"image_base64" must be a string', { code: 'invalid_image' });
  const match = /^data:([\w/.+-]+);base64,(.*)$/s.exec(input);
  const base64 = (match?.[2] ?? input).replace(/\s/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new HttpError(400, '"image_base64" is not valid base64', { code: 'invalid_image' });
  }
  // Size check before decoding the whole thing
  if (Math.floor((base64.length * 3) / 4) > maxBytes) {
    throw new HttpError(413, `Image exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`, { code: 'image_too_large' });
  }
  const buffer = Buffer.from(base64, 'base64');
  const sig = SIGNATURES.find((s) => buffer.length >= 12 && s.test(buffer));
  if (!sig) {
    throw new HttpError(415, 'Image must be JPEG, PNG or WebP', { code: 'unsupported_image_type' });
  }
  return { buffer, contentType: sig.type, ext: sig.ext };
}
