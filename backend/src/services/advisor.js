/**
 * Agronomic advisor: validated pest counts + microclimate -> risk level + plan.
 *
 * LLM provider: Gemini (@google/genai) or Claude (@anthropic-ai/sdk), chosen by
 * ADVISOR_PROVIDER (auto prefers Gemini when GEMINI_API_KEY is set).
 *
 * Every advisory records where it came from:
 *   source: 'gemini' | 'claude'  status: 'ok'
 *   source: 'rule-engine'        status: 'not_configured'  (no LLM key)
 *   source: 'rule-engine'        status: 'fallback'        (LLM failed; `error.provider`/`error.code` say why, `degraded: true`)
 *
 * LLM output is constrained with a JSON schema AND re-validated here before
 * it is saved. The model only returns text; it never touches the database.
 * There is no automatic model switching: a refusal or error falls back to the
 * deterministic rule engine and is labelled as such.
 */
import Anthropic from '@anthropic-ai/sdk';

const RISK_LEVELS = ['Low', 'Medium', 'High'];
const CONFIDENCE_LEVELS = ['Low', 'Medium', 'High'];
const MAX_TEXT = 600;
const MAX_STEPS = 6;

/** JSON schema Claude's response is constrained to. */
export const ADVISORY_SCHEMA = {
  type: 'object',
  properties: {
    risk_level: { type: 'string', enum: RISK_LEVELS },
    confidence: {
      type: 'string',
      enum: CONFIDENCE_LEVELS,
      description: 'How well the available evidence supports this assessment',
    },
    summary: { type: 'string', description: 'One or two sentences describing the situation and any data limitations' },
    recommendation: { type: 'string', description: 'The single most important action right now' },
    mitigation_strategy: {
      type: 'array',
      items: { type: 'string' },
      description: '3-5 ordered, concrete steps (monitoring and IPM first, chemical control last)',
    },
  },
  required: ['risk_level', 'confidence', 'summary', 'recommendation', 'mitigation_strategy'],
  additionalProperties: false,
};

export const SYSTEM_PROMPT = `You are an integrated pest management (IPM) adviser supporting a farmer who uses yellow sticky traps.
You receive: insect counts per class from an automated detector with confidence statistics, the capture time,
temperature (°C) and relative humidity (%) if measured, recent capture history, and whether the data is simulated.

Rules:
- Base the risk level only on the data provided. Sticky-trap counts indicate flying-insect activity, not confirmed crop damage.
- If the evidence is thin (few captures, missing sensor readings, low detection confidence, simulated data), say so in the summary and set confidence to Low.
- Never state exact pesticide doses, mixing rates or product brand names. Refer to "the product label rate" and local extension guidance instead.
- Prefer monitoring, cultural, mechanical and biological controls. Mention chemical control only for High risk, and always mention label instructions and pre-harvest intervals.
- Recommend in-field scouting to confirm the detector's findings before any treatment.
- Keep each step under 30 words.

Decision (when provided):
- "decision" is the output of a fixed, predator-aware rule (average pests/day over the last days vs. an action level,
  then pests per predator vs. a spray ratio). It is SPRAY, BIOCONTROL (release more natural enemies) or WAIT.
- Do NOT change or contradict the decision. Explain it in plain language a farmer understands: say why, using the
  averages, the predator ratio and the thresholds given. Make the recommendation carry out that decision.
- Match the risk level to it: SPRAY -> High, BIOCONTROL -> Medium, WAIT -> Low.
- If "borderline" is true, say clearly that the counts are close to a threshold and ask for a re-check / scouting first.
- For BIOCONTROL, stress protecting the predators already present (avoid broad-spectrum sprays).`;

// Dose-like phrases ("2 ml/L", "500 g per ha") are replaced so no invented dosage is ever stored
const DOSE_RE = /\b\d+(?:[.,]\d+)?\s?(?:ml|mL|l|L|g|kg|oz|lb|cc)\s?(?:\/|per)\s?(?:l|L|litre|liter|ha|hectare|acre|gal|gallon|m²|m2|100\s?m²)\b/g;
const scrubDoses = (s) => s.replace(DOSE_RE, 'the product label rate');

/**
 * Validates an untrusted advisory object. Returns {ok, value} or {ok:false, errors}.
 */
export function validateAdvisory(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['not an object'] };
  const extra = Object.keys(raw).filter((k) => !ADVISORY_SCHEMA.required.includes(k));
  if (extra.length) errors.push(`unexpected fields: ${extra.join(', ')}`);
  if (!RISK_LEVELS.includes(raw.risk_level)) errors.push('risk_level must be Low, Medium or High');
  if (!CONFIDENCE_LEVELS.includes(raw.confidence)) errors.push('confidence must be Low, Medium or High');
  for (const f of ['summary', 'recommendation']) {
    if (typeof raw[f] !== 'string' || !raw[f].trim()) errors.push(`${f} must be a non-empty string`);
    else if (raw[f].length > MAX_TEXT * 2) errors.push(`${f} is too long`);
  }
  const steps = raw.mitigation_strategy;
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 10) {
    errors.push('mitigation_strategy must be an array of 1-10 strings');
  } else if (steps.some((s) => typeof s !== 'string' || !s.trim())) {
    errors.push('mitigation_strategy items must be non-empty strings');
  }
  if (errors.length) return { ok: false, errors };

  const clean = (s) => scrubDoses(s.trim()).slice(0, MAX_TEXT);
  return {
    ok: true,
    value: {
      risk_level: raw.risk_level,
      confidence: raw.confidence,
      summary: clean(raw.summary),
      recommendation: clean(raw.recommendation),
      mitigation_strategy: steps.slice(0, MAX_STEPS).map(clean),
    },
  };
}

/** Maps any failure to a stable, secret-free error code. */
export function classifyClaudeError(err) {
  const is = (name) => typeof Anthropic[name] === 'function' && err instanceof Anthropic[name];
  if (err?.code === 'refusal') return { code: 'refusal', message: err.message };
  if (err?.code === 'invalid_output' || err?.code === 'truncated') return { code: err.code, message: err.message };
  if (err instanceof SyntaxError) return { code: 'invalid_json', message: 'Claude returned unparseable JSON' };
  if (is('AuthenticationError')) return { code: 'auth_error', message: 'Anthropic API key was rejected' };
  if (is('PermissionDeniedError')) return { code: 'permission_denied', message: 'API key lacks access to this model' };
  if (is('NotFoundError')) return { code: 'model_not_found', message: 'Configured CLAUDE_MODEL was not found' };
  if (is('RateLimitError')) return { code: 'rate_limited', message: 'Anthropic rate limit reached' };
  if (is('APIConnectionTimeoutError')) return { code: 'timeout', message: 'Claude request timed out' };
  if (is('APIConnectionError')) return { code: 'network_error', message: 'Could not reach the Anthropic API' };
  if (is('BadRequestError')) return { code: 'bad_request', message: 'Anthropic rejected the request (400)' };
  if (is('APIError') && err.status >= 500) return { code: 'api_unavailable', message: `Anthropic API error ${err.status}` };
  if (is('APIError')) return { code: `api_error_${err.status ?? 'unknown'}`, message: 'Anthropic API error' };
  return { code: 'unknown_error', message: 'Unexpected advisor error' };
}

const fmt = (n, digits = 1) => (n === null || n === undefined ? null : Number(n.toFixed(digits)));

/** Deterministic fallback advisor based on simple IPM heuristics. */
export function ruleBasedAdvisory({ pest_counts, temperature, humidity, history = [], detection = {}, decision = null }) {
  const total = Object.values(pest_counts).reduce((a, b) => a + b, 0);
  const prevTotals = history.map((h) => h.total).filter((n) => Number.isFinite(n));
  const prev = prevTotals.length ? prevTotals[prevTotals.length - 1] : null;
  const rising = prev !== null && total > prev * 1.25 && total - prev >= 5;
  const climateKnown = temperature !== null && humidity !== null;
  const warmHumid = climateKnown && temperature >= 22 && temperature <= 32 && humidity >= 70;

  let score = 0;
  if (total >= 40) score += 2;
  else if (total >= 15) score += 1;
  if (rising) score += 1;
  if (warmHumid) score += 1;
  const risk_level = score >= 3 ? 'High' : score >= 1 ? 'Medium' : 'Low';

  const limits = [];
  if (prevTotals.length < 3) limits.push('fewer than 3 earlier captures to establish a trend');
  if (!climateKnown) limits.push('temperature/humidity not measured');
  if (detection.simulated) limits.push('detections are simulated demo data');
  if (detection.mean_confidence !== null && detection.mean_confidence < 0.6) limits.push('low detector confidence');
  const confidence = limits.length >= 2 ? 'Low' : limits.length === 1 ? 'Medium' : 'High';

  const top = Object.entries(pest_counts).sort((a, b) => b[1] - a[1])[0] ?? ['insects', 0];
  const pest = top[1] > 0 ? top[0].replace(/_/g, ' ') : 'insects';

  const steps = {
    Low: [
      'Keep replacing sticky traps weekly and log counts to establish a baseline.',
      'Scout 10 random plants for early colonies on leaf undersides.',
      'Maintain ventilation to keep relative humidity below about 70%.',
    ],
    Medium: [
      `Scout plants near the trap to confirm ${pest} activity on new growth and leaf undersides.`,
      'Add more traps to map where pressure is building.',
      'Consider releasing beneficial insects suited to the confirmed pest (ask local extension services).',
      'Improve airflow / ventilation to bring humidity down.',
    ],
    High: [
      `Scout within 24h to confirm ${pest} on plants before treating; trap counts alone are not a diagnosis.`,
      'Remove heavily infested plants and weeds that act as reservoirs.',
      'Combine biological control with ventilation to break the warm/humid breeding window.',
      'If scouting confirms an outbreak, use a registered product at the product label rate, respecting the pre-harvest interval.',
    ],
  }[risk_level];

  const climate = climateKnown ? `${temperature.toFixed(1)}°C / ${humidity.toFixed(0)}% RH` : 'microclimate not measured';

  // With a predator-aware decision, the advisory explains and carries it out
  if (decision?.decision) {
    const check = decision.borderline
      ? ['Counts are close to a threshold: re-check the trap and scout plants before acting.']
      : [];
    const plan = {
      SPRAY: [
        `Scout within 24h to confirm ${pest} on plants; predators are too few to keep up.`,
        'If confirmed, spray a registered product at the product label rate, respecting the pre-harvest interval.',
        'Spray in calm, dry conditions and target the infested area rather than the whole field.',
        'Keep the trap in place and compare counts 3-5 days after spraying.',
      ],
      BIOCONTROL: [
        'Release more natural enemies (e.g. predator bugs or parasitoids) instead of spraying.',
        'Avoid broad-spectrum sprays that would kill the predators already on the trap.',
        `Scout to confirm ${pest} hot spots and release beneficials there first.`,
        'Keep counting daily; if pests per predator rise past the spray level, reconsider.',
      ],
      WAIT: [
        'No action needed yet: keep the trap in place and count daily.',
        `Scout 10 random plants for early ${pest} colonies on leaf undersides.`,
        'Maintain ventilation to keep relative humidity below about 70%.',
      ],
    }[decision.decision];
    const all = [...check, ...plan];
    const risk = { SPRAY: 'High', BIOCONTROL: 'Medium', WAIT: 'Low' }[decision.decision];
    return {
      risk_level: risk,
      confidence: decision.borderline && confidence === 'High' ? 'Medium' : confidence,
      summary: `${decision.label}: ${decision.reason} Latest capture: ${total} insects (mostly ${pest}), ${climate}.${
        limits.length ? ` Limited evidence: ${limits.join('; ')}.` : ''
      }`,
      recommendation: all[0],
      mitigation_strategy: all.slice(0, MAX_STEPS),
    };
  }

  return {
    risk_level,
    confidence,
    summary: `${total} insects trapped (mostly ${pest}), ${climate}${rising ? ', a sharp rise since the last capture' : ''}.${
      limits.length ? ` Limited evidence: ${limits.join('; ')}.` : ''
    }`,
    recommendation: steps[0],
    mitigation_strategy: steps,
  };
}

/** Builds the (already validated) context object sent to Claude. */
function buildPrompt(ctx) {
  const payload = {
    capture_time_utc: ctx.capture_time,
    device: ctx.device_name,
    data_source: ctx.detection.simulated ? 'SIMULATED demo data (synthetic trap image)' : 'camera image + vision model',
    pest_counts: ctx.pest_counts,
    total_insects: Object.values(ctx.pest_counts).reduce((a, b) => a + b, 0),
    detection_confidence: {
      mean: ctx.detection.mean_confidence,
      min: ctx.detection.min_confidence,
      boxes_counted: ctx.detection.counted,
      threshold: ctx.detection.threshold,
    },
    temperature_c: ctx.temperature ?? 'not measured',
    relative_humidity_pct: ctx.humidity ?? 'not measured',
    recent_history_oldest_first: ctx.history,
  };
  if (ctx.decision?.decision) {
    const d = ctx.decision;
    payload.decision = {
      decision: d.decision,
      label: d.label,
      avg_pests_per_day: d.avg_pests,
      avg_predators_per_day: d.avg_predators,
      pests_per_predator: d.no_predators ? 'no predators seen' : d.pests_per_predator,
      days_averaged: d.window.days,
      borderline: d.borderline,
      could_also_be: d.possible_decisions.slice(1),
      count_range: d.range,
      thresholds: d.thresholds,
      rule_reason: d.reason,
    };
  }
  return `Latest sticky-trap capture:\n${JSON.stringify(payload, null, 2)}\n\nReturn the advisory JSON.`;
}

// ---------------------------------------------------------------------------
// Gemini (official @google/genai SDK)
// ---------------------------------------------------------------------------

/** Gemini's JSON-schema support is a subset; extra fields are still rejected by validateAdvisory. */
const { additionalProperties: _omit, ...GEMINI_SCHEMA } = ADVISORY_SCHEMA;

const GEMINI_BLOCK_REASONS = ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY'];

/** Maps Gemini SDK / HTTP failures to the same stable codes used for Claude. */
export function classifyGeminiError(err) {
  if (['refusal', 'invalid_output', 'truncated'].includes(err?.code)) return { code: err.code, message: err.message };
  if (err instanceof SyntaxError) return { code: 'invalid_json', message: 'Gemini returned unparseable JSON' };
  const status = Number(err?.status);
  const msg = String(err?.message ?? '');
  if (status === 400 && /api[_ ]?key/i.test(msg)) return { code: 'auth_error', message: 'Gemini API key was rejected' };
  if (status === 401 || status === 403) return { code: 'auth_error', message: 'Gemini API key was rejected or lacks access' };
  if (status === 404) return { code: 'model_not_found', message: 'Configured GEMINI_MODEL was not found' };
  if (status === 429) return { code: 'rate_limited', message: 'Gemini quota or rate limit reached' };
  if (status === 400) return { code: 'bad_request', message: 'Gemini rejected the request (400)' };
  if (status >= 500) return { code: 'api_unavailable', message: `Gemini API error ${status}` };
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || /timed? ?out/i.test(msg)) {
    return { code: 'timeout', message: 'Gemini request timed out' };
  }
  if (!status) return { code: 'network_error', message: 'Could not reach the Gemini API' };
  return { code: `api_error_${status}`, message: 'Gemini API error' };
}

export async function createGeminiClient(g) {
  const { GoogleGenAI } = await import('@google/genai');
  return new GoogleGenAI({
    apiKey: g.apiKey,
    httpOptions: { timeout: g.timeoutMs, retryOptions: { attempts: g.maxRetries + 1 } },
  });
}

async function askGemini(client, g, ctx) {
  const response = await client.models.generateContent({
    model: g.model,
    contents: buildPrompt(ctx),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseJsonSchema: GEMINI_SCHEMA,
      maxOutputTokens: 8192,
    },
  });

  const blocked = response.promptFeedback?.blockReason;
  if (blocked) throw Object.assign(new Error(`Gemini blocked the prompt (${blocked})`), { code: 'refusal' });
  const finish = response.candidates?.[0]?.finishReason;
  if (GEMINI_BLOCK_REASONS.includes(finish)) {
    throw Object.assign(new Error(`Gemini stopped for ${finish}`), { code: 'refusal' });
  }
  if (finish === 'MAX_TOKENS') throw Object.assign(new Error('Gemini response truncated'), { code: 'truncated' });

  const text = response.text;
  if (!text) throw Object.assign(new Error('Gemini returned no text'), { code: 'invalid_output' });
  const result = validateAdvisory(JSON.parse(text));
  if (!result.ok) {
    throw Object.assign(new Error(`Gemini output failed validation: ${result.errors.join('; ')}`), { code: 'invalid_output' });
  }
  return { advisory: result.value, model: response.modelVersion ?? g.model };
}

// ---------------------------------------------------------------------------
// Advisor factory
// ---------------------------------------------------------------------------

/**
 * @param {{config: object, client?: object, logger?: object}} deps
 *   `client` is injectable for tests (Anthropic- or GoogleGenAI-shaped,
 *   matching config.advisor.provider); defaults to the official SDKs.
 */
export function createAdvisor({ config, client, logger }) {
  const provider = config.advisor?.provider ?? (config.claude.apiKey ? 'claude' : 'none');
  const settings = provider === 'gemini' ? config.gemini : config.claude;
  const model = settings.model;
  let sdk = client ?? null;

  const getClaude = () =>
    (sdk ??= new Anthropic({ apiKey: config.claude.apiKey, timeout: config.claude.timeoutMs, maxRetries: config.claude.maxRetries }));

  const ask = async (ctx) => {
    if (provider === 'gemini') {
      sdk ??= await createGeminiClient(config.gemini);
      return askGemini(sdk, config.gemini, ctx);
    }
    return askClaude(ctx);
  };
  const classify = provider === 'gemini' ? classifyGeminiError : classifyClaudeError;

  async function askClaude(ctx) {
    const c = config.claude;
    const response = await getClaude().messages.create({
      model: c.model,
      max_tokens: 8000,
      output_config: { effort: c.effort, format: { type: 'json_schema', schema: ADVISORY_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildPrompt(ctx) }],
    });

    if (response.stop_reason === 'refusal') {
      throw Object.assign(new Error(`Claude declined (${response.stop_details?.category ?? 'unspecified'})`), { code: 'refusal' });
    }
    if (response.stop_reason === 'max_tokens') {
      throw Object.assign(new Error('Claude response truncated'), { code: 'truncated' });
    }
    const text = (response.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const result = validateAdvisory(JSON.parse(text));
    if (!result.ok) {
      throw Object.assign(new Error(`Claude output failed validation: ${result.errors.join('; ')}`), { code: 'invalid_output' });
    }
    return { advisory: result.value, model: response.model ?? c.model };
  }

  const configured = provider !== 'none';

  return {
    describe: () => ({
      state: configured ? 'configured' : 'not_configured',
      provider: configured ? provider : null,
      model: configured ? model : null,
    }),

    /** Never throws. */
    async generate(ctx) {
      const generated_at = new Date().toISOString();
      if (configured) {
        const started = Date.now();
        try {
          const { advisory, model: used } = await ask(ctx);
          return { ...advisory, source: provider, status: 'ok', model: used, generated_at, latency_ms: Date.now() - started };
        } catch (err) {
          const error = { ...classify(err), provider };
          logger?.warn('advisor_llm_failed', { provider, code: error.code });
          return {
            ...ruleBasedAdvisory(ctx),
            source: 'rule-engine',
            status: 'fallback',
            degraded: true,
            error,
            generated_at,
          };
        }
      }
      return { ...ruleBasedAdvisory(ctx), source: 'rule-engine', status: 'not_configured', generated_at };
    },
  };
}
