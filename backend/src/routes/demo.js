/**
 * Demo mode routes (admin)
 *   POST   /api/admin/demo/reset   delete + reseed the 4 DEMO traps with 14 days of SIMULATED captures
 *   DELETE /api/admin/demo         remove the DEMO traps and their captures
 *   GET    /api/demo               which traps are demo traps (public; used for labels)
 *
 * Seeding uses the demo detector and the rule engine only: no vision or LLM
 * API calls, so a reset costs nothing and works offline.
 */
import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { DEMO_DAYS, DEMO_TRAPS, clearDemo, resetDemo } from '../services/demoData.js';

export function demoRouter({ config, store, vision, logger }) {
  const router = Router();
  const adminLimit = rateLimit({ name: 'admin', windowMs: config.rateLimit.windowMs, max: config.rateLimit.adminMax });

  router.get('/demo', (req, res) => {
    res.json({ days: DEMO_DAYS, traps: DEMO_TRAPS.map(({ id, name }) => ({ id, name })) });
  });

  router.post('/admin/demo/reset', adminLimit, requireAdmin(config), async (req, res) => {
    const started = Date.now();
    // Synthetic trap images are served by this API, so point them at the host the request reached
    const publicUrl = `${req.protocol}://${req.get('host')}`;
    const result = await resetDemo({ store, vision, config, publicUrl });
    logger.info('demo_reset', { captures: result.captures, ms: Date.now() - started });
    res.status(201).json(result);
  });

  router.delete('/admin/demo', adminLimit, requireAdmin(config), async (req, res) => {
    res.json(await clearDemo({ store }));
  });

  return router;
}
