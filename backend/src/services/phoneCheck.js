/**
 * Phone check pipeline, shared by POST /api/check and the Telegram photo bot:
 * quality gate -> vision (the phone model when PHONE_VISION_URL is set, e.g. AgroPest-12,
 * otherwise the trap model: Roboflow with tiling) -> predator-aware decision -> advisory.
 *
 * The card collected insects over `daysHung` days, so per-day counts are the
 * totals divided by that, and the decision averages them like a trap's daily
 * series (a card that hung 1-2 days is flagged as a short window). Nothing is stored.
 */
import { evaluateDecision, withTrapCheck } from './decision.js';
import { DECISION_CONFIG } from './pestConfig.js';

export const MAX_DAYS_HUNG = 30;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {{config, vision, advisor}} deps
 * @param {{image: {buffer, contentType}, daysHung: number, temperature?: number|null, humidity?: number|null, source?: string}} input
 */
export async function runPhoneCheck({ config, vision, advisor }, { image, daysHung, temperature = null, humidity = null, source = 'Phone check' }) {
  const windowDays = DECISION_CONFIG.rollingWindowDays;
  const result = await vision.detect({ image });
  const now = Date.now();

  let decision;
  let perDay = null;
  if (result.counts && result.totals) {
    const counted = result.boxes.filter((b) => b.confidence >= (vision.minConfidence ?? config.vision.minConfidence));
    const confs = counted.map((b) => b.confidence);
    const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
    perDay = { pests: result.totals.pests / daysHung, predators: result.totals.predators / daysHung };
    // Same per-day series a trap would have: the card's catch spread evenly over the days it hung
    const days = Array.from({ length: daysHung }, (_, i) => ({
      date: isoDay(now - (daysHung - 1 - i) * 86_400_000),
      pests: perDay.pests,
      predators: perDay.predators,
      confidence,
    }));
    decision = evaluateDecision(days);
    // Word the reason for one card, not a trap's daily series
    const span = `over the ${daysHung} day${daysHung === 1 ? '' : 's'} the card hung`;
    const short =
      daysHung < windowDays
        ? ` The card hung only ${daysHung} day${daysHung === 1 ? '' : 's'}; a card left ${windowDays}+ days gives a steadier average.`
        : '';
    decision = {
      ...decision,
      reason:
        decision.reason
          .replace(/over the last \d+ days|on the latest day/, span)
          .replace(/ \(only \d+ of \d+ days available so far\)/, '') + short,
    };
  } else {
    decision = withTrapCheck(evaluateDecision([]), {
      status: result.status,
      timestamp: new Date(now).toISOString(),
      reason: result.quality?.reason ?? undefined,
    });
  }

  let advisory = null;
  if (result.counts) {
    advisory = await advisor.generate({
      capture_time: new Date(now).toISOString(),
      device_name: `${source} (card hung ${daysHung} day${daysHung === 1 ? '' : 's'})`,
      pest_counts: result.counts,
      temperature,
      humidity,
      history: [],
      decision,
      detection: {
        simulated: result.status === 'simulated',
        counted: result.boxes.length,
        threshold: config.vision.minConfidence,
        mean_confidence: decision.range?.mean_confidence ?? null,
        min_confidence: null,
      },
    });
  }

  return {
    days_hung: daysHung,
    counts: result.counts,
    totals: result.totals,
    per_day: perDay && { pests: round1(perDay.pests), predators: round1(perDay.predators) },
    decision,
    advisory,
    quality: result.quality ?? null,
    annotated_image: result.annotated_image ?? null,
    vision: {
      status: result.status,
      provider: result.provider,
      model: result.model,
      experimental: Boolean(result.experimental),
      error: result.error,
      fallback: result.fallback ?? null,
      image: result.image,
      boxes: result.boxes.length,
    },
    stored: false,
  };
}
