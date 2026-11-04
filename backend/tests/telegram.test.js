/**
 * Telegram summaries + alerts (English + Kannada) against a fake Bot API.
 * No real messages are sent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TEXT, alertText, chunk, summaryText } from '../src/services/telegram.js';
import { ADMIN_KEY, DEVICE, mockTrapUrl, startApp } from './helpers.js';

const TOKEN = '123456789:AAH_test-token-abcdefghijklmnopqrstuv';
const env = { ADMIN_API_KEY: ADMIN_KEY, TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '987654321', TELEGRAM_SUMMARY_TIME: '' };
const admin = { 'X-Admin-Key': ADMIN_KEY };

/** Fake Bot API: records sendMessage calls; getUpdates returns one private chat. */
function fakeTelegram({ fail = false, updates = [{ message: { chat: { id: 987654321, type: 'private', first_name: 'Ravi' } } }], getStatus = null } = {}) {
  const sent = [];
  return {
    sent,
    post: async (url, body) => {
      if (fail) throw Object.assign(new Error(`Request failed: ${url}`), { response: { status: 403, data: { description: 'Forbidden: bot was blocked by the user' } } });
      sent.push({ url, ...body });
      return { data: { ok: true } };
    },
    get: async (url) => {
      if (getStatus) throw Object.assign(new Error(`Request failed: ${url}`), { response: { status: getStatus, data: { description: 'Unauthorized' } } });
      if (url.endsWith('/getMe')) return { data: { ok: true, result: { username: 'Agrisense_test_bot', first_name: 'Agrisense' } } };
      return { data: { ok: true, result: updates } };
    },
  };
}

const spray = { decision: 'SPRAY', reason: 'Average 40 pests/day over the last 3 days is above the action level of 25.', avg_pests: 40, pests_per_predator: null, no_predators: true, borderline: false, simulated: true };

describe('Telegram text', () => {
  test('summary: traps with traffic-light icons, both languages, spray window, footer', () => {
    const text = summaryText({
      traps: [
        { name: 'Polyhouse 1', decision: spray },
        { name: 'Net-house', decision: { decision: 'WAIT', avg_pests: 22.7, pests_per_predator: 22.7, borderline: true } },
      ],
      weather: { available: true, spray: { can_spray_now: false, next_window: { start: 's', end: 'e' } } },
      languages: ['en', 'kn'],
      date: '4 Nov 2026',
      fmtWindow: () => 'Wed 06:00-09:00',
      dashboardUrl: 'https://agrisense.example/',
    });
    assert.match(text, /🔴▲ <b>Polyhouse 1<\/b>: SPRAY - 40 pests\/day, no predators, simulated/);
    assert.match(text, /🟢● <b>Net-house<\/b>: WAIT - 22.7 pests\/day, 22.7 per predator, BORDERLINE/);
    assert.match(text, /Next good window: Wed 06:00-09:00/);
    assert.match(text, /ಸಿಂಪಡಿಸಿ/); // Kannada SPRAY
    assert.match(text, /ದಿನಕ್ಕೆ 40 ಕೀಟಗಳು/);
    assert.match(text, /Decision support only/);
    assert.match(text, /<a href="https:\/\/agrisense.example\/">Open dashboard<\/a>/);
  });

  test('alert: change from WAIT to SPRAY, English reason + Kannada numbers; HTML escaped', () => {
    const text = alertText({ name: 'Trap <1>', previous: 'WAIT', decision: spray, languages: ['en', 'kn'] });
    assert.match(text, /Trap &lt;1&gt;: advice changed from WAIT to 🔴▲ SPRAY/);
    assert.match(text, /above the action level/);
    assert.match(text, /ಕಾಯಿರಿ ಇಂದ 🔴▲ ಸಿಂಪಡಿಸಿ ಗೆ ಬದಲಾಗಿದೆ/);
  });

  test('every decision has a label in both languages; long text is split under the limit', () => {
    for (const lang of ['en', 'kn']) for (const d of ['SPRAY', 'BIOCONTROL', 'WAIT', 'CHECK_TRAP']) assert.ok(TEXT[lang].decision[d]);
    const parts = chunk(Array.from({ length: 300 }, (_, i) => `line ${i} ${'x'.repeat(40)}`).join('\n'));
    assert.ok(parts.length > 1);
    assert.ok(parts.every((p) => p.length <= 3900));
  });
});

describe('Telegram API + alerts', () => {
  test('not configured: status says so, sending is a clear 409, ingestion unaffected', async () => {
    const app = await startApp({ env: { ADMIN_API_KEY: ADMIN_KEY } });
    try {
      assert.equal((await app.request('GET', '/api/admin/telegram', { headers: admin })).body.state, 'not_configured');
      const r = await app.request('POST', '/api/admin/telegram/test', { headers: admin });
      assert.equal(r.status, 409);
      assert.match(r.body.error, /TELEGRAM_BOT_TOKEN/);
      assert.equal((await app.request('POST', '/api/telemetry', { body: { temperature: 25, image_url: mockTrapUrl('t0', 0.9) } })).status, 201);
      // The preview still works, for checking the wording before setup
      const preview = await app.request('GET', '/api/admin/telegram/preview', { headers: admin });
      assert.match(preview.body.text, /AgriSense trap summary/);
    } finally {
      await app.close();
    }
  });

  test('admin-only; test + summary go to the chat; the token never appears in responses', async () => {
    const tg = fakeTelegram();
    const app = await startApp({ env, telegramHttp: tg });
    try {
      assert.equal((await app.request('POST', '/api/admin/telegram/test')).status, 401);
      const t = await app.request('POST', '/api/admin/telegram/test', { headers: admin });
      assert.equal(t.status, 200);
      assert.equal(tg.sent[0].chat_id, '987654321');
      assert.equal(tg.sent[0].parse_mode, 'HTML');
      assert.match(tg.sent[0].text, /AgriSense is connected/);
      assert.match(tg.sent[0].text, /ಅಗ್ರಿಸೆನ್ಸ್ ಸಂಪರ್ಕಗೊಂಡಿದೆ/);

      await app.request('POST', '/api/telemetry', { body: { temperature: 25, image_url: mockTrapUrl('s1', 0.9) } });
      const s = await app.request('POST', '/api/admin/telegram/summary', { headers: admin });
      assert.equal(s.status, 200);
      assert.match(tg.sent.at(-1).text, /Greenhouse A|Trap 11111111/);

      const status = await app.request('GET', '/api/admin/telegram', { headers: admin });
      const chats = await app.request('GET', '/api/admin/telegram/chats', { headers: admin });
      assert.deepEqual(chats.body.chats, [{ id: 987654321, type: 'private', name: 'Ravi' }]);
      assert.deepEqual(chats.body.bot, { username: 'Agrisense_test_bot', name: 'Agrisense' });
      for (const r of [t, s, status, chats]) assert.ok(!JSON.stringify(r.body).includes(TOKEN.split(':')[1]));
      assert.equal(status.body.chats, 1);
    } finally {
      await app.close();
    }
  });

  test('alert fires once when the advice turns SPRAY, not for WAIT or repeats', async () => {
    const tg = fakeTelegram();
    const app = await startApp({ env, telegramHttp: tg });
    try {
      const capture = (seed, d) => app.request('POST', '/api/telemetry', { body: { device_id: DEVICE, temperature: 25, image_url: mockTrapUrl(seed, d) } });
      await capture('low', 0.05); // WAIT -> no alert
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(tg.sent.length, 0);
      await capture('high', 1.5); // big card -> SPRAY -> alert
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(tg.sent.length, 1);
      assert.match(tg.sent[0].text, /Trap alert/);
      assert.match(tg.sent[0].text, /SPRAY/);
      await capture('high2', 1.5); // still SPRAY -> no repeat
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(tg.sent.length, 1);
    } finally {
      await app.close();
    }
  });

  test('Telegram failure: clear 502 with Telegram\'s reason, no token in it', async () => {
    const app = await startApp({ env, telegramHttp: fakeTelegram({ fail: true }) });
    try {
      const r = await app.request('POST', '/api/admin/telegram/test', { headers: admin });
      assert.equal(r.status, 502);
      assert.equal(r.body.code, 'telegram_http_403');
      assert.match(r.body.error, /bot was blocked/);
      assert.ok(!JSON.stringify(r.body).includes(TOKEN.split(':')[1]));
    } finally {
      await app.close();
    }
  });

  test('chat lookup: names the bot when nobody has messaged it; a wrong token gets a clear fix', async () => {
    const empty = await startApp({ env, telegramHttp: fakeTelegram({ updates: [] }) });
    try {
      const r = await empty.request('GET', '/api/admin/telegram/chats', { headers: admin });
      assert.equal(r.status, 200);
      assert.deepEqual(r.body.chats, []);
      assert.equal(r.body.bot.username, 'Agrisense_test_bot');
    } finally {
      await empty.close();
    }
    const bad = await startApp({ env, telegramHttp: fakeTelegram({ getStatus: 401 }) });
    try {
      const r = await bad.request('GET', '/api/admin/telegram/chats', { headers: admin });
      assert.equal(r.status, 502);
      assert.equal(r.body.code, 'telegram_http_401');
      assert.match(r.body.error, /rejected the bot token.*@BotFather/);
      assert.ok(!JSON.stringify(r.body).includes(TOKEN.split(':')[1]));
    } finally {
      await bad.close();
    }
  });

  test('config: TELEGRAM_LANGUAGE=kn sends Kannada only', async () => {
    const tg = fakeTelegram();
    const app = await startApp({ env: { ...env, TELEGRAM_LANGUAGE: 'kn' }, telegramHttp: tg });
    try {
      await app.request('POST', '/api/admin/telegram/test', { headers: admin });
      assert.doesNotMatch(tg.sent[0].text, /AgriSense is connected/);
      assert.match(tg.sent[0].text, /ಸಂಪರ್ಕಗೊಂಡಿದೆ/);
    } finally {
      await app.close();
    }
  });

  test('manual spray: logs the action and sends a Telegram message; failure is reported, not fatal', async () => {
    const tg = fakeTelegram();
    const app = await startApp({ env, telegramHttp: tg });
    try {
      await app.request('POST', '/api/telemetry', { body: { temperature: 26 }, headers: admin });
      await new Promise((r) => setTimeout(r, 50)); // let the capture's own decision alert go first
      const before = tg.sent.length;
      const r = await app.request('POST', '/api/actions', { body: { device_id: DEVICE, action: 'sprayed', note: 'east rows', notify: true }, headers: admin });
      assert.equal(r.status, 201);
      assert.deepEqual(r.body.telegram, { ok: true, code: null });
      assert.equal(tg.sent.length, before + 1);
      assert.match(tg.sent.at(-1).text, /Manual spray started/);
      assert.match(tg.sent.at(-1).text, /east rows/);
      // Without notify nothing is sent
      await app.request('POST', '/api/actions', { body: { device_id: DEVICE, action: 'sprayed' }, headers: admin });
      assert.equal(tg.sent.length, before + 1);
    } finally {
      await app.close();
    }
    const down = await startApp({ env, telegramHttp: fakeTelegram({ fail: true }) });
    try {
      await down.request('POST', '/api/telemetry', { body: { temperature: 26 }, headers: admin });
      const r = await down.request('POST', '/api/actions', { body: { device_id: DEVICE, action: 'sprayed', notify: true }, headers: admin });
      assert.equal(r.status, 201); // still logged
      assert.equal(r.body.telegram.ok, false);
      assert.equal(r.body.telegram.code, 'telegram_http_403');
    } finally {
      await down.close();
    }
  });
});
