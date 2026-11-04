/**
 * Trap-box hardware controls (fan, trap light, Raspberry Pi)
 *   GET   /api/devices/:id/controls              state for the dashboard (public read)
 *   PATCH /api/devices/:id/controls              {fan?, trap_light?} desired switch states (admin)
 *   POST  /api/devices/:id/commands              {command: capture_now|restart_camera|reboot} (admin)
 *   GET   /api/devices/:id/commands/pending      the Pi's poll (device key)
 *   POST  /api/devices/:id/commands/ack          {command_id?, ok?, message?, switches?} (device key)
 */
import { Router } from 'express';
import { requireAdmin, requireDevice } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { COMMANDS, SWITCHES } from '../services/controls.js';
import { HttpError, isUuid, requireUuid } from '../utils/validate.js';

const MAX_MESSAGE = 200;

export function controlsRouter({ config, store, controls, logger }) {
  const router = Router();
  const adminLimit = rateLimit({ name: 'admin', windowMs: config.rateLimit.windowMs, max: config.rateLimit.adminMax });

  /** Known trap id from the path (404 for unknown traps). */
  const trapId = async (req) => {
    const id = requireUuid(req.params.id, 'id');
    if (!(await store.getDevice(id))) throw new HttpError(404, 'Unknown trap', { code: 'unknown_device' });
    return id;
  };
  /** A device key bound to one trap may only act for that trap. */
  const ownTrap = (req, id) => {
    if (req.auth?.deviceId && req.auth.deviceId !== id) {
      throw new HttpError(403, 'This device key may only act for its own trap', { code: 'device_mismatch' });
    }
  };

  router.get('/devices/:id/controls', async (req, res) => {
    res.json(controls.describe(await trapId(req)));
  });

  router.patch('/devices/:id/controls', adminLimit, requireAdmin(config), async (req, res) => {
    const id = await trapId(req);
    const body = req.body ?? {};
    const patch = {};
    for (const k of SWITCHES) {
      if (body[k] === undefined) continue;
      if (typeof body[k] !== 'boolean') throw new HttpError(422, `"${k}" must be true or false`, { code: 'invalid_switch' });
      patch[k] = body[k];
    }
    if (!Object.keys(patch).length) throw new HttpError(422, `Send at least one of: ${SWITCHES.join(', ')}`, { code: 'empty_patch' });
    logger.info('controls_set', { request_id: req.id, device_id: id, ...patch });
    res.json(controls.setSwitches(id, patch));
  });

  router.post('/devices/:id/commands', adminLimit, requireAdmin(config), async (req, res) => {
    const id = await trapId(req);
    const command = req.body?.command;
    if (!COMMANDS.includes(command)) throw new HttpError(422, `"command" must be one of: ${COMMANDS.join(', ')}`, { code: 'invalid_command' });
    const cmd = controls.queue(id, command);
    logger.info('command_queued', { request_id: req.id, device_id: id, command });
    res.status(201).json(cmd);
  });

  router.get('/devices/:id/commands/pending', requireDevice(config), async (req, res) => {
    const id = await trapId(req);
    ownTrap(req, id);
    res.json(controls.poll(id));
  });

  router.post('/devices/:id/commands/ack', requireDevice(config), async (req, res) => {
    const id = await trapId(req);
    ownTrap(req, id);
    const body = req.body ?? {};
    if (body.command_id !== undefined && !isUuid(body.command_id)) throw new HttpError(400, '"command_id" must be a UUID', { code: 'invalid_command_id' });
    if (body.message != null && (typeof body.message !== 'string' || body.message.length > MAX_MESSAGE)) {
      throw new HttpError(422, `"message" must be text of at most ${MAX_MESSAGE} characters`, { code: 'invalid_message' });
    }
    const r = controls.ack(id, { commandId: body.command_id, ok: body.ok !== false, message: body.message ?? null, switches: body.switches });
    if (!r) throw new HttpError(404, 'No such command', { code: 'not_found' });
    res.json(r);
  });

  return router;
}
