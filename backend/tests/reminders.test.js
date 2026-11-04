/**
 * Telegram reminders for a treatment time (1 h before), and /api/lifecycle basics.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ADMIN_KEY, DEVICE, startApp } from './helpers.js';

const env = { ADMIN_API_KEY: ADMIN_KEY, TELEGRAM_BOT_TOKEN: '123456789:AAFakeTokenForTestsOnly_abcdefghijklmn', TELEGRAM_CHAT_ID: '987654321', TELEGRAM_SUMMARY_TIME: '', TELEGRAM_PHOTO_BOT: 'false' };
const admin = { 'X-Admin-Key': ADMIN_KEY };
const tg = () => ({ post: async () => ({ data: { ok: true, result: {} } }), get: async () => ({ data: { ok: true, result: [] } }) });

describe('treatment reminders', () => {
  test('a reminder is queued one hour before the target; bad input is refused', async () => {
    const app = await startApp({ env, telegramHttp: tg() });
    try {
      await app.request('POST', '/api/telemetry', { body: { temperature: 25 }, headers: admin });
      const at = new Date(Date.now() + 26 * 3_600_000).toISOString();
      const body = { device_id: DEVICE, at, text: 'Target vulnerable nymphs at 06:00 AM Monday.' };
      assert.equal((await app.request('POST', '/api/admin/telegram/remind', { body })).status, 401);
      const ok = await app.request('POST', '/api/admin/telegram/remind', { body, headers: admin });
      assert.equal(ok.status, 201);
      assert.equal(Date.parse(ok.body.remind_at), Date.parse(at) - 3_600_000);
      const far = await app.request('POST', '/api/admin/telegram/remind', { body: { ...body, at: new Date(Date.now() + 30 * 86_400_000).toISOString() }, headers: admin });
      assert.equal(far.status, 422);
      const noText = await app.request('POST', '/api/admin/telegram/remind', { body: { ...body, text: '' }, headers: admin });
      assert.equal(noText.status, 422);
    } finally {
      await app.close();
    }
  });

  test('/api/lifecycle: unknown trap 404, weather down -> available:false', async () => {
    const app = await startApp({ env: { ADMIN_API_KEY: ADMIN_KEY } });
    try {
      assert.equal((await app.request('GET', '/api/lifecycle?device_id=nope')).status, 400);
      assert.equal((await app.request('GET', '/api/lifecycle?device_id=aaaaaaaa-0000-4000-8000-0000000000ff')).status, 404);
      await app.request('POST', '/api/telemetry', { body: { temperature: 25 }, headers: admin });
      const r = await app.request('GET', `/api/lifecycle?device_id=${DEVICE}`);
      assert.equal(r.status, 200);
      assert.equal(r.body.available, false);
    } finally {
      await app.close();
    }
  });
});
