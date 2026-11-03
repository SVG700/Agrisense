/**
 * Phone check
 *   POST /api/check   {image_base64, days_hung, temperature?, humidity?}
 *
 * A farmer photographs a sticky card and says how many days it hung. The same
 * pipeline as a trap capture runs (quality gate -> Roboflow with tiling ->
 * predator-aware decision -> advisory that explains it), and the answer comes
 * straight back. Nothing is stored. Rate-limited, because each check can cost
 * vision/LLM calls.
 *
 * The card collected insects over `days_hung` days, so per-day counts are the
 * totals divided by that, and the decision averages them like a trap's daily
 * series (a card that hung 1-2 days is flagged as a short window).
 */
import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { evaluateDecision, withTrapCheck } from '../services/decision.js';
import { DECISION_CONFIG } from '../services/pestConfig.js';
import { HttpError, decodeImage, optionalReading } from '../utils/validate.js';

const MAX_DAYS_HUNG = 30;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const round1 = (n) => Math.round(n * 10) / 10;

export function checkRouter({ config: appConfig, vision, advisor, logger }) {
  const router = Router();
  const config = { ...appConfig, decisionWindowDays: DECISION_CONFIG.rollingWindowDays };

  router.post(
    '/check',
    rateLimit({ name: 'check', windowMs: config.rateLimit.windowMs, max: config.rateLimit.checkMax }),
    async (req, res) => {
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be a JSON object', { code: 'invalid_body' });
      }
      if (body.image_base64 == null) throw new HttpError(400, 'A trap photo (image_base64) is required', { code: 'missing_image' });
      const daysHung = body.days_hung;
      if (!Number.isInteger(daysHung) || daysHung < 1 || daysHung > MAX_DAYS_HUNG) {
        throw new HttpError(422, `"days_hung" must be a whole number of days between 1 and ${MAX_DAYS_HUNG}`, { code: 'invalid_days_hung' });
      }
      const image = decodeImage(body.image_base64, config.maxImageBytes);
      const temperature = optionalReading(body.temperature, 'temperature');
      const humidity = optionalReading(body.humidity, 'humidity');

      const started = Date.now();
      const result = await vision.detect({ image });
      const now = Date.now();

      // Same per-day series a trap would have: the card's catch spread evenly over the days it hung
      let decision;
      let perDay = null;
      if (result.counts && result.totals) {
        const counted = result.boxes.filter((b) => b.confidence >= config.vision.minConfidence);
        const confs = counted.map((b) => b.confidence);
        const confidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
        perDay = { pests: result.totals.pests / daysHung, predators: result.totals.predators / daysHung };
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
          daysHung < config.decisionWindowDays
            ? ` The card hung only ${daysHung} day${daysHung === 1 ? '' : 's'}; a card left ${config.decisionWindowDays}+ days gives a steadier average.`
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
          device_name: `Phone check (card hung ${daysHung} day${daysHung === 1 ? '' : 's'})`,
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

      logger.info('phone_check', { request_id: req.id, vision: result.status, decision: decision.decision, ms: Date.now() - started });
      res.json({
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
          error: result.error,
          fallback: result.fallback ?? null,
          image: result.image,
          boxes: result.boxes.length,
        },
        stored: false,
      });
    }
  );

  return router;
}
