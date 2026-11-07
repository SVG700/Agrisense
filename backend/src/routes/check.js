/**
 * Phone check
 *   POST /api/check   {image_base64, days_hung, temperature?, humidity?}
 *
 * A farmer photographs a sticky card and says how many days it hung. The same
 * pipeline as a trap capture runs (services/phoneCheck.js - also used by the
 * Telegram photo bot), and the answer comes straight back. Nothing is stored.
 * Rate-limited, because each check can cost vision/LLM calls.
 */
import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { MAX_DAYS_HUNG, runPhoneCheck } from '../services/phoneCheck.js';
import { HttpError, decodeImage, optionalReading } from '../utils/validate.js';

export function checkRouter({ config, vision: trapVision, phoneVision, advisor, logger }) {
  // Phone photos go to the phone model (AgroPest-12) when one is configured, else the trap model
  const vision = phoneVision ?? trapVision;
  const router = Router();

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
      const out = await runPhoneCheck({ config, vision, advisor }, { image, daysHung, temperature, humidity });
      logger.info('phone_check', { request_id: req.id, vision: out.vision.status, decision: out.decision.decision, ms: Date.now() - started });
      res.json(out);
    }
  );

  return router;
}
