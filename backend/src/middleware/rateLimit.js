/**
 * Small fixed-window in-memory rate limiter (per client IP + bucket name).
 * Good enough for a single backend instance; use a shared store (Redis) if
 * the API is ever scaled horizontally.
 */
import { HttpError } from '../utils/validate.js';

export function rateLimit({ name, windowMs, max }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  sweep.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    let entry = hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    res.set('RateLimit-Limit', String(max));
    res.set('RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return next(new HttpError(429, 'Too many requests', { code: 'rate_limited' }));
    }
    next();
  };
}
