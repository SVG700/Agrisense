#!/usr/bin/env node
/**
 * One-command demo reset: re-seeds the 4 DEMO traps with 14 days of simulated
 * captures through the running API (POST /api/admin/demo/reset).
 *
 *   npm run demo:reset                 # API at http://localhost:4000
 *   API_URL=https://... npm run demo:reset
 *   npm run demo:reset -- --clear      # remove the demo traps instead
 *
 * Reads ADMIN_API_KEY from backend/.env (never printed).
 */
import 'dotenv/config';

const api = (process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`).replace(/\/$/, '');
const clear = process.argv.includes('--clear');
const headers = process.env.ADMIN_API_KEY ? { Authorization: `Bearer ${process.env.ADMIN_API_KEY}` } : {};

const res = await fetch(`${api}${clear ? '/api/admin/demo' : '/api/admin/demo/reset'}`, {
  method: clear ? 'DELETE' : 'POST',
  headers,
}).catch((err) => {
  console.error(`Cannot reach ${api} - is the backend running? (${err.message})`);
  process.exit(1);
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Demo ${clear ? 'clear' : 'reset'} failed (${res.status}): ${body.error ?? 'unknown error'}`);
  process.exit(1);
}
if (clear) {
  console.log(`Removed ${body.removed} demo trap(s).`);
} else {
  console.log(`Seeded ${body.captures} simulated captures over ${body.days} days:`);
  for (const t of body.traps) console.log(`  ${t.name.padEnd(32)} ${t.label}${t.borderline ? ' (BORDERLINE)' : ''}`);
}
