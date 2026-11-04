/**
 * Action log: what the farmer actually did after the advice.
 *   GET    /api/actions?device_id=&limit=   newest first (public read, like the dashboard)
 *   POST   /api/actions                     {device_id, action: sprayed|released|not_yet, note?, acted_at?, notify?} (admin)
 *                                           notify: true on "sprayed" also sends a Telegram message (the Manual spray button)
 *   DELETE /api/actions/:id                 undo a mistaken entry (admin)
 *
 * Each entry stores the advice shown at that moment (computed here, never taken
 * from the client), so the log reads "Sprayed - advice was SPRAY". Needs schema
 * v4 (supabase/migrations/v4_action_log.sql); without it the API says so (503).
 */
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { HttpError, StoreError, isUuid, requireUuid } from '../utils/validate.js';
import { trapDecision } from './map.js';

export const ACTIONS = ['sprayed', 'released', 'not_yet'];
const MAX_NOTE = 280;

/** Missing v4 table (or any store failure) -> one clear message. */
async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StoreError) {
      throw new HttpError(503, 'Action log unavailable - apply supabase/migrations/v4_action_log.sql in the Supabase SQL editor', {
        code: 'actions_unavailable',
      });
    }
    throw err;
  }
}

export function actionsRouter({ config, store, telegram, logger }) {
  const router = Router();
  const adminLimit = rateLimit({ name: 'admin', windowMs: config.rateLimit.windowMs, max: config.rateLimit.adminMax });

  router.get('/actions', async (req, res) => {
    const { device_id: deviceId } = req.query;
    if (deviceId !== undefined && !isUuid(deviceId)) throw new HttpError(400, '"device_id" must be a UUID', { code: 'invalid_device_id' });
    const limit = Math.min(200, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    res.json(await guarded(() => store.listActions({ deviceId, limit })));
  });

  router.post('/actions', adminLimit, requireAdmin(config), async (req, res) => {
    const body = req.body ?? {};
    const deviceId = requireUuid(body.device_id, 'device_id');
    if (!ACTIONS.includes(body.action)) {
      throw new HttpError(422, `"action" must be one of: ${ACTIONS.join(', ')}`, { code: 'invalid_action' });
    }
    if (body.note != null && (typeof body.note !== 'string' || body.note.length > MAX_NOTE)) {
      throw new HttpError(422, `"note" must be text of at most ${MAX_NOTE} characters`, { code: 'invalid_note' });
    }
    let actedAt = new Date();
    if (body.acted_at !== undefined) {
      actedAt = new Date(body.acted_at);
      if (Number.isNaN(actedAt.getTime()) || actedAt.getTime() > Date.now() + 5 * 60_000) {
        throw new HttpError(422, '"acted_at" must be a past ISO-8601 time', { code: 'invalid_acted_at' });
      }
    }
    if (!(await store.getDevice(deviceId))) throw new HttpError(404, 'Unknown trap', { code: 'unknown_device' });

    const advice = await trapDecision({ store }, deviceId);
    const [row] = await guarded(() =>
      store.addActions([
        {
          device_id: deviceId,
          action: body.action,
          decision: advice.decision ?? null,
          note: body.note?.trim() || null,
          acted_at: actedAt.toISOString(),
        },
      ])
    );
    logger.info('action_logged', { request_id: req.id, device_id: deviceId, action: body.action, decision: advice.decision });

    // Manual spray: the log entry is saved either way; Telegram's result is reported, never fatal
    let notified;
    if (body.notify === true && body.action === 'sprayed') {
      const device = await store.getDevice(deviceId);
      notified = telegram
        ? await telegram.notifySpray({ device, decision: advice.decision, note: row.note }).catch(() => ({ ok: false, code: 'telegram_failed' }))
        : { ok: false, code: 'not_configured' };
      notified = { ok: notified.ok, code: notified.code ?? null };
    }
    res.status(201).json(notified ? { ...row, telegram: notified } : row);
  });

  router.delete('/actions/:id', adminLimit, requireAdmin(config), async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid action id', { code: 'invalid_id' });
    const removed = await guarded(() => store.deleteAction(id));
    if (!removed) throw new HttpError(404, 'No such action', { code: 'not_found' });
    res.json({ removed });
  });

  return router;
}
