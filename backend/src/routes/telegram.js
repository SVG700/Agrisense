/**
 * Telegram admin routes (all admin-only; the token never leaves the backend)
 *   GET  /api/admin/telegram           status: configured?, language, schedule, last send result
 *   GET  /api/admin/telegram/preview   the summary text that would be sent now (works unconfigured)
 *   POST /api/admin/telegram/test      send a short "connected" message
 *   POST /api/admin/telegram/summary   send the trap summary now
 *   GET  /api/admin/telegram/chats     chats that messaged the bot (to find TELEGRAM_CHAT_ID)
 *   POST /api/admin/telegram/remind    {device_id, at, text} Telegram reminder 1 h before a treatment time
 *   GET  /api/admin/telegram/bot       photo bot status (listening?, checks, access)
 *   POST /api/admin/telegram/bot       {enabled: true|false} start / stop the photo bot
 */
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError } from '../utils/validate.js';

export function telegramRouter({ config, store, telegram, telegramBot }) {
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
  router.post('/admin/telegram/remind', async (req, res) => {
    const { device_id: deviceId, at, text } = req.body ?? {};
    const device = typeof deviceId === 'string' ? await store.getDevice(deviceId).catch(() => null) : null;
    if (!device) throw new HttpError(404, 'Unknown trap', { code: 'unknown_device' });
    if (typeof text !== 'string' || !text.trim() || text.length > 400) throw new HttpError(422, '"text" must be 1-400 characters', { code: 'invalid_text' });
    const r = telegram.remind({ at, deviceName: device.name, text: text.trim() });
    if (!r.ok) {
      if (r.code === 'not_configured') throw new HttpError(409, 'Telegram is not set up - add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to backend/.env', { code: 'telegram_not_configured' });
      throw new HttpError(422, r.code === 'too_many' ? 'Too many reminders queued' : '"at" must be a time within the next 14 days', { code: r.code });
    }
    res.status(201).json(r);
  });
  router.get('/admin/telegram/bot', (req, res) => res.json(telegramBot?.describe() ?? { enabled: false, state: 'off' }));
  router.post('/admin/telegram/bot', (req, res) => {
    if (!telegramBot) throw new HttpError(409, 'Telegram is not set up - add TELEGRAM_BOT_TOKEN to backend/.env', { code: 'telegram_not_configured' });
    if (typeof req.body?.enabled !== 'boolean') throw new HttpError(422, '"enabled" must be true or false', { code: 'invalid_enabled' });
    if (req.body.enabled) telegramBot.start();
    else telegramBot.stop();
    res.json(telegramBot.describe());
  });
  router.get('/admin/telegram/chats', async (req, res) => {
    // While the photo bot polls it receives every message, so it knows the chats
    if (telegramBot?.isRunning()) return res.json({ ok: true, chats: telegramBot.chats(), bot: telegramBot.me() });
    const r = await telegram.findChats();
    if (!r.ok && r.code === 'not_configured') {
      throw new HttpError(409, 'Add TELEGRAM_BOT_TOKEN to backend/.env first', { code: 'telegram_not_configured' });
    }
    if (!r.ok) {
      const why = {
        telegram_http_401: 'Telegram rejected the bot token - copy it again from @BotFather into TELEGRAM_BOT_TOKEN in backend/.env and restart',
        telegram_http_404: 'Telegram rejected the bot token - copy it again from @BotFather into TELEGRAM_BOT_TOKEN in backend/.env and restart',
        telegram_http_409: 'This bot has a webhook set, which blocks chat lookup - remove it with @BotFather or deleteWebhook',
        telegram_timeout: 'Telegram did not answer in time - check the internet connection and try again',
        telegram_unreachable: 'Could not reach Telegram from the backend - check the internet connection / firewall and try again',
      }[r.code];
      throw new HttpError(502, why ?? `Telegram error${r.description ? `: ${r.description}` : ''}`, { code: r.code });
    }
    res.json(r);
  });

  return router;
}
