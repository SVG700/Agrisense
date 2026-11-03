/**
 * Telegram admin routes (all admin-only; the token never leaves the backend)
 *   GET  /api/admin/telegram           status: configured?, language, schedule, last send result
 *   GET  /api/admin/telegram/preview   the summary text that would be sent now (works unconfigured)
 *   POST /api/admin/telegram/test      send a short "connected" message
 *   POST /api/admin/telegram/summary   send the trap summary now
 *   GET  /api/admin/telegram/chats     chats that messaged the bot (to find TELEGRAM_CHAT_ID)
 */
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError } from '../utils/validate.js';

export function telegramRouter({ config, telegram }) {
  const router = Router();
  const adminLimit = rateLimit({ name: 'admin', windowMs: config.rateLimit.windowMs, max: config.rateLimit.adminMax });
  router.use('/admin/telegram', adminLimit, requireAdmin(config));

  const result = (res, r) => {
    if (r.ok) return res.json(r);
    if (r.code === 'not_configured') {
      throw new HttpError(409, 'Telegram is not set up - add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to backend/.env', { code: 'telegram_not_configured' });
    }
    throw new HttpError(502, `Telegram did not accept the message${r.description ? `: ${r.description}` : ''}`, { code: r.code });
  };

  router.get('/admin/telegram', (req, res) => res.json(telegram.describe()));
  router.get('/admin/telegram/preview', async (req, res) => res.json({ text: await telegram.buildSummary() }));
  router.post('/admin/telegram/test', async (req, res) => result(res, await telegram.sendTest()));
  router.post('/admin/telegram/summary', async (req, res) => result(res, await telegram.sendSummary()));
  router.get('/admin/telegram/chats', async (req, res) => {
    const r = await telegram.findChats();
    if (!r.ok && r.code === 'not_configured') {
      throw new HttpError(409, 'Add TELEGRAM_BOT_TOKEN to backend/.env first', { code: 'telegram_not_configured' });
    }
    if (!r.ok) throw new HttpError(502, 'Could not reach Telegram', { code: r.code });
    res.json(r);
  });

  return router;
}
