/**
 * Telegram photo bot: trap photo in chat -> count, decision, advice and the
 * marked-up photo back. Driven with bot.handle(update); Telegram and Roboflow are fakes.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { renderTrapSvg } from '../src/services/mockTrap.js';
import { parseDays } from '../src/services/telegramBot.js';
import { fakeHttp, startApp } from './helpers.js';

const CHAT = 987654321;
const env = { ROBOFLOW_API_KEY: 'rk', VISION_QUALITY_CHECK: 'true', TELEGRAM_BOT_TOKEN: '123456789:AAFakeTokenForTestsOnly_abcdefghijklmn', TELEGRAM_CHAT_ID: String(CHAT), TELEGRAM_SUMMARY_TIME: '', TELEGRAM_LANGUAGE: 'en' };

let card;
before(async () => {
  card = await sharp(Buffer.from(renderTrapSvg('bot', 0.9, { mix: 'wf' })), { density: 108 }).resize(1200, 900).jpeg().toBuffer();
});

const roboflow = (wf, mr) =>
  fakeHttp(() => ({
    image: { width: 1200, height: 900 },
    predictions: [
      ...Array.from({ length: wf }, (_, i) => ({ class: 'WF', confidence: 0.9, x: 20 + (i % 40) * 28, y: 30 + Math.floor(i / 40) * 40, width: 12, height: 10 })),
      ...Array.from({ length: mr }, (_, i) => ({ class: 'MR', confidence: 0.85, x: 600 + i * 40, y: 800, width: 24, height: 9 })),
    ],
  }));

/** Fake Bot API: records every call; serves the trap photo for getFile/download. */
function fakeTelegram({ photo = () => card, size } = {}) {
  const calls = [];
  return {
    calls,
    sent: () => calls.filter((c) => c.method === 'sendMessage').map((c) => c.body.text),
    post: async (url, body) => {
      const method = url.split('/').pop();
      calls.push({ method, body });
      if (method === 'getFile') return { data: { ok: true, result: { file_path: 'photos/file_1.jpg', file_size: size } } };
      if (method === 'getMe') return { data: { ok: true, result: { username: 'agrisense_test_bot' } } };
      return { data: { ok: true, result: { message_id: 1 } } };
    },
    get: async (url) => {
      calls.push({ method: 'download', url });
      return { data: photo() };
    },
  };
}

const photoUpdate = (id, { caption, chat = CHAT, date = Math.floor(Date.now() / 1000) } = {}) => ({
  update_id: id,
  message: { message_id: 10 + id, date, chat: { id: chat, type: 'private', first_name: 'Ravi' }, caption, photo: [{ file_id: 'small', file_size: 1000 }, { file_id: 'big', file_size: 90_000 }] },
});
const textUpdate = (id, text, chat = CHAT) => ({ update_id: id, message: { message_id: 10 + id, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: 'private' }, text } });

describe('Telegram photo bot', () => {
  test('caption days: "7", "7 days", Kannada digits; out of range ignored', () => {
    assert.equal(parseDays('7'), 7);
    assert.equal(parseDays('hung 10 days'), 10);
    assert.equal(parseDays('೭ ದಿನ'), 7);
    assert.equal(parseDays('45'), null);
    assert.equal(parseDays(''), null);
  });

  test('a trap photo gets the count, the decision, the steps and the marked-up photo back', async () => {
    const tg = fakeTelegram();
    // 210 whiteflies + 3 predators over 7 days = 30/day -> SPRAY
    const app = await startApp({ env, visionHttp: roboflow(210, 3), telegramHttp: tg });
    try {
      await app.telegramBot.handle(photoUpdate(1, { caption: '7' }));
      const texts = tg.sent();
      assert.match(texts[0], /Checking your trap photo/);
      const result = texts.at(-1);
      assert.match(result, /SPRAY/);
      assert.match(result, /Insects counted: <b>210<\/b> \(30 pests\/day over 7 days\)/);
      assert.match(result, /Beneficial predators: <b>3<\/b>/);
      assert.match(result, /What to do/);
      assert.match(result, /scout the crop/);
      assert.equal(tg.calls.find((c) => c.method === 'getFile').body.file_id, 'big'); // the largest size
      const photo = tg.calls.find((c) => c.method === 'sendPhoto');
      assert.ok(photo, 'annotated photo sent back');
      assert.equal(app.telegramBot.describe().checks, 1);
      // Nothing is stored
      assert.equal((await app.request('GET', '/api/telemetry')).body.length, 0);
    } finally {
      await app.close();
    }
  });

  test('days come from the caption, then /days, then the default', async () => {
    const tg = fakeTelegram();
    const app = await startApp({ env, visionHttp: roboflow(60, 0), telegramHttp: tg });
    try {
      await app.telegramBot.handle(photoUpdate(1)); // default 7 days -> 8.6/day -> WAIT
      assert.match(tg.sent().at(-1), /WAIT[\s\S]*over 7 days/);
      await app.telegramBot.handle(textUpdate(2, '/days 2'));
      assert.match(tg.sent().at(-1), /hung 2 days/);
      await app.telegramBot.handle(photoUpdate(3)); // 30/day -> SPRAY
      assert.match(tg.sent().at(-1), /SPRAY[\s\S]*over 2 days/);
    } finally {
      await app.close();
    }
  });

  test('unknown chats are refused with their chat id; no vision call is made', async () => {
    const tg = fakeTelegram();
    const vision = roboflow(10, 0);
    const app = await startApp({ env, visionHttp: vision, telegramHttp: tg });
    try {
      await app.telegramBot.handle(photoUpdate(1, { chat: 5555 }));
      assert.match(tg.sent()[0], /only answers registered farms[\s\S]*5555/);
      assert.equal(vision.calls.length, 0);
      assert.equal(app.telegramBot.describe().refused, 1);
      // ... but they show up in "Find my chat id"
      assert.ok(app.telegramBot.chats().some((c) => c.id === 5555));
    } finally {
      await app.close();
    }
  });

  test('duplicates, stale messages, non-images and the hourly cap are handled', async () => {
    const tg = fakeTelegram({ photo: () => Buffer.from('this is not an image at all') });
    const app = await startApp({ env: { ...env, TELEGRAM_BOT_MAX_PER_HOUR: '2' }, visionHttp: roboflow(10, 0), telegramHttp: tg });
    try {
      await app.telegramBot.handle(photoUpdate(1));
      assert.match(tg.sent().at(-1), /send the trap as a photo/);
      const before = tg.calls.length;
      await app.telegramBot.handle(photoUpdate(1)); // same update id again
      assert.equal(tg.calls.length, before);
      await app.telegramBot.handle(photoUpdate(2, { date: Math.floor(Date.now() / 1000) - 3600 })); // an hour old
      assert.equal(tg.calls.length, before);
      await app.telegramBot.handle(photoUpdate(3));
      await app.telegramBot.handle(photoUpdate(4));
      assert.match(tg.sent().at(-1), /hourly limit/);
    } finally {
      await app.close();
    }
  });

  test('a photo larger than the limit is refused before downloading', async () => {
    const tg = fakeTelegram();
    const app = await startApp({ env: { ...env, MAX_IMAGE_BYTES: '50000' }, visionHttp: roboflow(10, 0), telegramHttp: tg });
    try {
      await app.telegramBot.handle(photoUpdate(1));
      assert.match(tg.sent().at(-1), /too large/);
      assert.ok(!tg.calls.some((c) => c.method === 'download'));
    } finally {
      await app.close();
    }
  });

  test('admin can read the bot status and start / stop it', async () => {
    const app = await startApp({ env: { ...env, ADMIN_API_KEY: 'admin-key-0123456789abcdef' }, telegramHttp: fakeTelegram() });
    const admin = { 'X-Admin-Key': 'admin-key-0123456789abcdef' };
    try {
      assert.equal((await app.request('GET', '/api/admin/telegram/bot')).status, 401);
      const s = (await app.request('GET', '/api/admin/telegram/bot', { headers: admin })).body;
      assert.equal(s.enabled, true);
      assert.equal(s.access, 'chats');
      assert.equal(s.allowed_chats, 1);
      assert.equal((await app.request('POST', '/api/admin/telegram/bot', { body: { enabled: 'yes' }, headers: admin })).status, 422);
      const stopped = (await app.request('POST', '/api/admin/telegram/bot', { body: { enabled: false }, headers: admin })).body;
      assert.equal(stopped.state, 'stopped');
    } finally {
      await app.close();
    }
  });
});
