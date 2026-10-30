/**
 * Configuration loading + validation.
 *
 * `loadConfig(env)` is pure (no side effects) so tests can build configs from a
 * plain object. It returns `{ config, errors, warnings }`:
 *   - errors   -> invalid configuration; the server refuses to start
 *   - warnings -> optional integrations missing / demo-mode relaxations
 * Secret values are never included in messages.
 */
import 'dotenv/config';

/** Fixed UUID of the demo device (also seeded by supabase/schema.sql). */
export const DEMO_DEVICE_ID = '11111111-1111-4111-8111-111111111111';

/** Battery percentage below which a device is flagged `low_battery`. */
export const LOW_BATTERY_THRESHOLD = 15;

/** Physical limits accepted for sensor readings (BME280 / DHT22 class sensors). */
export const SENSOR_LIMITS = {
  temperature: { min: -40, max: 85, unit: '°C' },
  humidity: { min: 0, max: 100, unit: '%' },
};

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const VISION_PROVIDERS = ['roboflow', 'generic'];
const ADVISOR_PROVIDERS = ['auto', 'gemini', 'claude', 'none'];

export function loadConfig(env = process.env) {
  const errors = [];
  const warnings = [];

  const str = (key, fallback = '') => String(env[key] ?? fallback).trim();
  const int = (key, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
    const raw = str(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) {
      errors.push(`${key} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return n;
  };
  const bool = (key, fallback) => {
    const raw = str(key).toLowerCase();
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
    if (['0', 'false', 'no', 'off'].includes(raw)) return false;
    errors.push(`${key} must be true or false`);
    return fallback;
  };
  const url = (key) => {
    const raw = str(key);
    if (!raw) return '';
    try {
      const u = new URL(raw);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      return raw.replace(/\/$/, '');
    } catch {
      errors.push(`${key} is not a valid http(s) URL`);
      return '';
    }
  };

  const nodeEnv = str('NODE_ENV', 'development');
  const production = nodeEnv === 'production';
  const port = int('PORT', 4000, 1, 65535);

  const config = {
    nodeEnv,
    production,
    port,
    publicBaseUrl: url('PUBLIC_BASE_URL') || `http://localhost:${port}`,
    corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    trustProxy: bool('TRUST_PROXY', false),
    requestTimeoutMs: int('REQUEST_TIMEOUT_MS', 120_000, 1000, 600_000),
    maxImageBytes: int('MAX_IMAGE_BYTES', 10 * 1024 * 1024, 1024, 20 * 1024 * 1024),

    // Demo mode keeps the no-credential experience: simulated detections for
    // synthetic trap images and unauthenticated access when no keys are set.
    demoMode: bool('DEMO_MODE', !production),

    auth: {
      deviceKeys: str('DEVICE_API_KEYS')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
      adminKey: str('ADMIN_API_KEY'),
    },

    rateLimit: {
      windowMs: int('RATE_LIMIT_WINDOW_MS', 60_000, 1000),
      ingestMax: int('RATE_LIMIT_INGEST_MAX', 120, 1),
      adminMax: int('RATE_LIMIT_ADMIN_MAX', 60, 1),
    },

    supabase: {
      url: url('SUPABASE_URL'),
      serviceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
      bucket: str('SUPABASE_BUCKET', 'trap-images'),
      signedUrlTtlSec: int('SUPABASE_SIGNED_URL_TTL', 3600, 60, 7 * 24 * 3600),
    },

    vision: {
      provider: str('VISION_PROVIDER', 'roboflow').toLowerCase(),
      url: url('YOLO_API_URL'),
      apiKey: str('YOLO_API_KEY'),
      modelId: str('VISION_MODEL_ID'),
      minConfidence: Number(str('VISION_MIN_CONFIDENCE', '0.5')),
      timeoutMs: int('YOLO_TIMEOUT_MS', 15_000, 1000, 120_000),
    },

    // Which LLM writes advisories: auto = Gemini if GEMINI_API_KEY is set, else Claude if
    // ANTHROPIC_API_KEY is set, else the rule engine only.
    advisor: { provider: str('ADVISOR_PROVIDER', 'auto').toLowerCase() },

    gemini: {
      apiKey: str('GEMINI_API_KEY'),
      model: str('GEMINI_MODEL', 'gemini-3.8-flash'),
      timeoutMs: int('GEMINI_TIMEOUT_MS', 30_000, 1000, 600_000),
      maxRetries: int('GEMINI_MAX_RETRIES', 2, 0, 5),
    },

    claude: {
      apiKey: str('ANTHROPIC_API_KEY'),
      model: str('CLAUDE_MODEL', 'claude-opus-5-5'),
      effort: str('CLAUDE_EFFORT', 'medium').toLowerCase(),
      timeoutMs: int('CLAUDE_TIMEOUT_MS', 60_000, 1000, 600_000),
      maxRetries: int('CLAUDE_MAX_RETRIES', 2, 0, 5),
    },
  };

  // ---- Cross-field validation ---------------------------------------------
  const sb = config.supabase;
  if (Boolean(sb.url) !== Boolean(sb.serviceRoleKey)) {
    errors.push('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set together');
  }
  if (!VISION_PROVIDERS.includes(config.vision.provider)) {
    errors.push(`VISION_PROVIDER must be one of: ${VISION_PROVIDERS.join(', ')}`);
  }
  if (config.vision.url && config.vision.provider === 'roboflow' && !config.vision.apiKey) {
    errors.push('YOLO_API_KEY is required when VISION_PROVIDER=roboflow');
  }
  const mc = config.vision.minConfidence;
  if (!Number.isFinite(mc) || mc < 0 || mc > 1) errors.push('VISION_MIN_CONFIDENCE must be between 0 and 1');
  if (!EFFORTS.includes(config.claude.effort)) errors.push(`CLAUDE_EFFORT must be one of: ${EFFORTS.join(', ')}`);
  if (!/^[a-z0-9][a-z0-9.-]{2,80}$/i.test(config.claude.model)) errors.push('CLAUDE_MODEL is not a valid model id');
  if (!/^[a-z0-9][a-z0-9.-]{2,80}$/i.test(config.gemini.model)) errors.push('GEMINI_MODEL is not a valid model id');

  // Resolve the advisor provider
  const requested = config.advisor.provider;
  if (!ADVISOR_PROVIDERS.includes(requested)) {
    errors.push(`ADVISOR_PROVIDER must be one of: ${ADVISOR_PROVIDERS.join(', ')}`);
  } else if (requested === 'gemini' && !config.gemini.apiKey) {
    errors.push('ADVISOR_PROVIDER=gemini requires GEMINI_API_KEY');
  } else if (requested === 'claude' && !config.claude.apiKey) {
    errors.push('ADVISOR_PROVIDER=claude requires ANTHROPIC_API_KEY');
  }
  config.advisor.provider =
    requested !== 'auto'
      ? requested
      : config.gemini.apiKey
        ? 'gemini'
        : config.claude.apiKey
          ? 'claude'
          : 'none';

  // DEVICE_API_KEYS entries: "<key>" (any device) or "<device-uuid>:<key>" (bound to one device)
  config.auth.devices = config.auth.deviceKeys.map((entry) => {
    const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):(.+)$/i.exec(entry);
    return m ? { deviceId: m[1].toLowerCase(), key: m[2] } : { deviceId: null, key: entry };
  });
  config.auth.deviceKeys = config.auth.devices.map((d) => d.key);
  if (config.auth.devices.some((d) => d.deviceId && d.key.length < 16)) {
    errors.push('Each DEVICE_API_KEYS entry must be at least 16 characters');
  }
  if (config.auth.adminKey && config.auth.adminKey.length < 16) {
    errors.push('ADMIN_API_KEY must be at least 16 characters');
  }
  if (config.auth.deviceKeys.some((k) => k.length < 16)) {
    errors.push('Each DEVICE_API_KEYS entry must be at least 16 characters');
  }
  if (config.corsOrigins.includes('*') && production) {
    errors.push('CORS_ORIGINS=* is not allowed in production');
  }

  // Auth: required outside demo mode
  if (!config.auth.deviceKeys.length) {
    if (config.demoMode) warnings.push('DEVICE_API_KEYS not set - telemetry ingestion is UNAUTHENTICATED (demo mode)');
    else errors.push('DEVICE_API_KEYS is required when DEMO_MODE=false');
  }
  if (!config.auth.adminKey) {
    if (config.demoMode) warnings.push('ADMIN_API_KEY not set - admin endpoints are UNAUTHENTICATED (demo mode)');
    else errors.push('ADMIN_API_KEY is required when DEMO_MODE=false');
  }

  if (!sb.url) warnings.push('Supabase not configured - using the in-memory store (data is lost on restart)');
  if (!config.vision.url) warnings.push('Vision API not configured - only synthetic demo traps get (simulated) detections');
  if (config.advisor.provider === 'none') {
    warnings.push('No GEMINI_API_KEY / ANTHROPIC_API_KEY - advisories come from the rule engine');
  }

  return { config, errors, warnings };
}

/** Which integrations are configured (booleans only - safe to expose). */
export function integrationFlags(config) {
  return {
    supabase: Boolean(config.supabase.url && config.supabase.serviceRoleKey),
    yolo: Boolean(config.vision.url),
    gemini: config.advisor.provider === 'gemini',
    claude: config.advisor.provider === 'claude',
  };
}
