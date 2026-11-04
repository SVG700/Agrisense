/**
 * POST /api/voice  {text, lang?: en|kn}  ->  audio/wav of the text in a natural Gemini voice
 *
 * Public like the dashboard, so it is rate-limited, length-capped and cached
 * (the same advice is only synthesised once).
 */
import { Router } from 'express';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError } from '../utils/validate.js';

export function voiceRouter({ config, voice }) {
  const router = Router();
  const limit = rateLimit({ name: 'voice', windowMs: config.rateLimit.windowMs, max: config.rateLimit.checkMax });

  router.get('/voice', (_req, res) => res.json(voice.describe()));

  router.post('/voice', limit, async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    const lang = req.body?.lang === 'kn' ? 'kn' : 'en';
    if (!text) throw new HttpError(422, '"text" is required', { code: 'invalid_text' });
    if (text.length > config.voice.maxChars) {
      throw new HttpError(413, `"text" must be at most ${config.voice.maxChars} characters`, { code: 'text_too_long' });
    }
    const r = await voice.speak({ text, lang });
    if (!r.ok) {
      if (r.retryAfter) res.set('Retry-After', String(r.retryAfter));
      const status = r.code === 'not_configured' ? 503 : r.code === 'rate_limited' ? 429 : 502;
      throw new HttpError(status, r.message, { code: r.code === 'not_configured' ? 'voice_not_configured' : `voice_${r.code}` });
    }
    res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'private, max-age=3600', 'X-Voice-Cache': r.cached ? 'hit' : 'miss' });
    res.send(r.wav);
  });

  return router;
}
