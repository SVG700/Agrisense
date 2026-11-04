/**
 * Telegram photo bot: a farmer sends a sticky-trap photo to the bot and gets
 * the insect count, the traffic-light decision and what to do, plus the
 * photo with every insect marked. Same pipeline as Phone Check (nothing stored).
 *
 * Long polling (getUpdates), so it works from a laptop: no public URL or
 * webhook needed. Hardened for real use:
 *   - access: only the configured TELEGRAM_CHAT_ID chats (default), or anyone
 *   - one check at a time per chat, an hourly cap per chat, 2 checks at once overall
 *   - image size / type checked before any vision call
 *   - updates de-duplicated; messages older than 10 min skipped after a restart
 *   - network errors back off (2 s -> 60 s); a webhook conflict (409) stops polling with a clear status
 *   - the token sits in the URL path, so errors are reduced to codes before logging
 */
import axios from 'axios';
import { TEXT, moneyLine } from './telegram.js';
import { MAX_DAYS_HUNG, runPhoneCheck } from './phoneCheck.js';
import { decodeImage } from '../utils/validate.js';
import { predictLifecycle } from './lifecycle.js';

const API = 'https://api.telegram.org';
const MAX_AGE_S = 10 * 60; // ignore photos older than this (e.g. sent while the backend was off)
const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
const MAX_CONCURRENT = 2;
const ICON = { SPRAY: '🔴▲', BIOCONTROL: '🟠◆', WAIT: '🟢●', CHECK_TRAP: '⚪■' };

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

/** Bot replies, per language (Kannada wording is a first draft for review). */
export const BOT_TEXT = {
  en: {
    help: (days) =>
      `<b>AgriSense trap check</b>\nSend a clear photo of your yellow sticky card. Write how many days it hung as the caption (for example <code>7</code>); without a number I assume ${days} days.\n\nCommands: /days 7 · /lang en | kn | both · /help`,
    working: 'Checking your trap photo…',
    insects: (n, rate, days) => `Insects counted: <b>${n}</b> (${rate} pests/day over ${days} day${days === 1 ? '' : 's'})`,
    predators: (n) => `Beneficial predators: <b>${n}</b>`,
    why: 'Why',
    todo: 'What to do',
    retake: 'Photo problem - please retake:',
    simulated: '⚠️ The detection model was unavailable, so these counts are SIMULATED (demo detector) - do not act on them.',
    footer: 'Decision support only - scout the crop before treating.',
    notAllowed: (id) => `This bot only answers registered farms. Ask the admin to add your chat id <code>${id}</code> to TELEGRAM_CHAT_ID.`,
    tooMany: 'You have reached the hourly limit of trap checks. Please try again later.',
    busy: 'Still checking your previous photo - one moment.',
    notImage: 'Please send the trap as a photo (JPEG or PNG).',
    tooBig: 'That photo is too large. Please send it as a normal photo, not a file.',
    failed: 'Sorry, the photo could not be checked right now. Please try again in a few minutes.',
    daysSet: (n) => `OK - I will assume the card hung ${n} day${n === 1 ? '' : 's'} when there is no number in the caption.`,
    langSet: 'Language updated.',
    caption: 'Every insect found is marked on your photo.',
  },
  kn: {
    help: (days) =>
      `<b>ಅಗ್ರಿಸೆನ್ಸ್ ಬಲೆ ಪರಿಶೀಲನೆ</b>\nನಿಮ್ಮ ಹಳದಿ ಅಂಟು ಕಾರ್ಡ್‌ನ ಸ್ಪಷ್ಟ ಚಿತ್ರ ಕಳುಹಿಸಿ. ಅದು ಎಷ್ಟು ದಿನ ನೇತಾಡಿತು ಎಂದು ಶೀರ್ಷಿಕೆಯಲ್ಲಿ ಬರೆಯಿರಿ (ಉದಾ. <code>7</code>); ಸಂಖ್ಯೆ ಇಲ್ಲದಿದ್ದರೆ ${days} ದಿನಗಳೆಂದು ಭಾವಿಸುತ್ತೇನೆ.\n\nಆಜ್ಞೆಗಳು: /days 7 · /lang en | kn | both · /help`,
    working: 'ನಿಮ್ಮ ಬಲೆಯ ಚಿತ್ರ ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…',
    insects: (n, rate, days) => `ಎಣಿಸಿದ ಕೀಟಗಳು: <b>${n}</b> (${days} ದಿನಗಳಲ್ಲಿ ದಿನಕ್ಕೆ ${rate} ಕೀಟಗಳು)`,
    predators: (n) => `ಉಪಯುಕ್ತ ಪರಭಕ್ಷಕಗಳು: <b>${n}</b>`,
    why: 'ಕಾರಣ',
    todo: 'ಮಾಡಬೇಕಾದದ್ದು',
    retake: 'ಚಿತ್ರದಲ್ಲಿ ಸಮಸ್ಯೆ - ದಯವಿಟ್ಟು ಮತ್ತೆ ತೆಗೆಯಿರಿ:',
    simulated: '⚠️ ಪತ್ತೆ ಮಾದರಿ ಲಭ್ಯವಿರಲಿಲ್ಲ, ಆದ್ದರಿಂದ ಈ ಎಣಿಕೆಗಳು ಅನುಕರಿಸಿದವು - ಇವುಗಳ ಮೇಲೆ ಕ್ರಮ ಕೈಗೊಳ್ಳಬೇಡಿ.',
    footer: 'ಇದು ನಿರ್ಧಾರಕ್ಕೆ ಸಹಾಯ ಮಾತ್ರ - ಔಷಧಿ ಬಳಸುವ ಮೊದಲು ಬೆಳೆಯನ್ನು ಪರಿಶೀಲಿಸಿ.',
    notAllowed: (id) => `ಈ ಬಾಟ್ ನೋಂದಾಯಿತ ಹೊಲಗಳಿಗೆ ಮಾತ್ರ ಉತ್ತರಿಸುತ್ತದೆ. ನಿಮ್ಮ ಚಾಟ್ ಐಡಿ <code>${id}</code> ಸೇರಿಸಲು ನಿರ್ವಾಹಕರನ್ನು ಕೇಳಿ.`,
    tooMany: 'ಈ ಗಂಟೆಯ ಪರಿಶೀಲನೆಗಳ ಮಿತಿ ತಲುಪಿದೆ. ದಯವಿಟ್ಟು ನಂತರ ಪ್ರಯತ್ನಿಸಿ.',
    busy: 'ಹಿಂದಿನ ಚಿತ್ರ ಇನ್ನೂ ಪರಿಶೀಲನೆಯಲ್ಲಿದೆ - ಸ್ವಲ್ಪ ಕಾಯಿರಿ.',
    notImage: 'ದಯವಿಟ್ಟು ಬಲೆಯನ್ನು ಚಿತ್ರವಾಗಿ ಕಳುಹಿಸಿ (JPEG ಅಥವಾ PNG).',
    tooBig: 'ಚಿತ್ರ ತುಂಬಾ ದೊಡ್ಡದಾಗಿದೆ. ಫೈಲ್ ಬದಲು ಸಾಮಾನ್ಯ ಚಿತ್ರವಾಗಿ ಕಳುಹಿಸಿ.',
    failed: 'ಕ್ಷಮಿಸಿ, ಈಗ ಚಿತ್ರ ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ. ಕೆಲವು ನಿಮಿಷಗಳ ನಂತರ ಪ್ರಯತ್ನಿಸಿ.',
    daysSet: (n) => `ಸರಿ - ಶೀರ್ಷಿಕೆಯಲ್ಲಿ ಸಂಖ್ಯೆ ಇಲ್ಲದಿದ್ದರೆ ಕಾರ್ಡ್ ${n} ದಿನ ನೇತಾಡಿತು ಎಂದು ಭಾವಿಸುತ್ತೇನೆ.`,
    langSet: 'ಭಾಷೆ ಬದಲಾಯಿಸಲಾಗಿದೆ.',
    caption: 'ಸಿಕ್ಕ ಪ್ರತಿಯೊಂದು ಕೀಟವನ್ನು ನಿಮ್ಮ ಚಿತ್ರದಲ್ಲಿ ಗುರುತಿಸಲಾಗಿದೆ.',
  },
};

/** "7", "7 days", "hung 7d", "೭" -> 7 (1-30), else null. */
export function parseDays(caption) {
  const digits = String(caption ?? '').replace(/[೦-೯]/g, (d) => String('೦೧೨೩೪೫೬೭೮೯'.indexOf(d)));
  const m = /(^|\D)(\d{1,2})(?!\d)/.exec(digits);
  const n = m ? Number(m[2]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= MAX_DAYS_HUNG ? n : null;
}

/** The reply text for one check, in one language. */
export function resultText(lang, out, timing = null) {
  const T = BOT_TEXT[lang];
  const d = out.decision;
  const label = TEXT[lang].decision[d.decision] ?? d.decision;
  const lines = [`<b>${ICON[d.decision] ?? ''} ${esc(label)}</b>${d.borderline ? ` (${esc(TEXT[lang].borderline)})` : ''}`];
  if (out.totals) {
    lines.push(T.insects(out.totals.pests, out.per_day.pests, out.days_hung), T.predators(out.totals.predators));
  }
  if (out.quality && !out.quality.ok) {
    lines.push('', `<b>${T.retake}</b>`, ...(out.quality.advice ?? []).map((a) => `• ${esc(a)}`));
  }
  if (d.reason) lines.push('', `<b>${T.why}:</b> ${esc(d.reason)}`);
  const money = moneyLine(lang, d);
  if (money) lines.push('', money);
  if (timing) lines.push('', `⏱ ${esc(timing)}`);
  const steps = (out.advisory?.mitigation_strategy?.length ? out.advisory.mitigation_strategy : [out.advisory?.recommendation]).filter(Boolean).slice(0, 3);
  if (steps.length) lines.push('', `<b>${T.todo}:</b>`, ...steps.map((s, i) => `${i + 1}. ${esc(s)}`));
  if (out.vision.status === 'simulated' || out.vision.fallback) lines.push('', T.simulated);
  lines.push('', `<i>${T.footer}</i>`);
  return lines.join('\n');
}

/**
 * @param {{config, vision, advisor, http?, logger?}} deps
 */
export function createTelegramBot({ config, vision, advisor, weather, http = axios, logger }) {
  const tg = config.telegram;
  const bot = tg.bot;
  const enabledByConfig = Boolean(tg.token && bot.enabled);
  const allowed = new Set(tg.chatIds.map(String));
  const base = `${API}/bot${tg.token}`;

  let running = false;
  let stopRequested = false;
  let offset = 0;
  let failures = 0;
  let active = 0;
  let me = null;
  const status = { state: enabledByConfig ? 'starting' : 'off', last_poll_at: null, last_error: null, checks: 0, refused: 0, started_at: null };
  const seen = new Map(); // chat id -> {id, type, name, at} (for "Find my chat id" while polling)
  const prefs = new Map(); // chat id -> {lang, days}
  const busy = new Set(); // chats with a check in progress
  const hourly = new Map(); // chat id -> [timestamps]
  const handled = new Set(); // update ids already processed (de-dupe)

  const code = (err) =>
    err?.response?.status ? `telegram_http_${err.response.status}` : err?.code === 'ECONNABORTED' ? 'telegram_timeout' : 'telegram_unreachable';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function call(method, body, opts = {}) {
    const { data } = await http.post(`${base}/${method}`, body, { timeout: tg.timeoutMs, ...opts });
    return data?.result;
  }

  /** Sends with up to 2 retries on network trouble (never throws). */
  async function send(chatId, text, extra = {}) {
    for (let i = 0; i < 3; i++) {
      try {
        return await call('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, ...extra });
      } catch (err) {
        if (err?.response?.status && err.response.status < 500 && err.response.status !== 429) break;
        await sleep(800 * (i + 1));
      }
    }
    logger?.warn('telegram_bot_send_failed', { chat: String(chatId).slice(-4) });
    return null;
  }

  async function sendPhoto(chatId, dataUrl, caption) {
    try {
      const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec(dataUrl ?? '');
      if (!m) return;
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', caption);
      form.append('photo', new Blob([Buffer.from(m[2], 'base64')], { type: m[1] }), 'trap-checked.jpg');
      await call('sendPhoto', form, { timeout: Math.max(tg.timeoutMs, 30_000) });
    } catch (err) {
      logger?.warn('telegram_bot_photo_failed', { code: code(err) });
    }
  }

  const langsFor = (chatId) => {
    const l = prefs.get(chatId)?.lang ?? tg.language;
    return l === 'both' ? ['en', 'kn'] : [l === 'kn' ? 'kn' : 'en'];
  };
  const textFor = (chatId, fn) => langsFor(chatId).map(fn).join('\n\n');

  function withinHourlyLimit(chatId) {
    const now = Date.now();
    const list = (hourly.get(chatId) ?? []).filter((t) => now - t < 3_600_000);
    if (list.length >= bot.maxPerHour) {
      hourly.set(chatId, list);
      return false;
    }
    list.push(now);
    hourly.set(chatId, list);
    return true;
  }

  /** Downloads the largest photo (or an image document) within the size limit. */
  async function download(msg) {
    const file = msg.photo?.length ? msg.photo.at(-1) : msg.document?.mime_type?.startsWith('image/') ? msg.document : null;
    if (!file) return { error: 'notImage' };
    if (file.file_size && file.file_size > config.maxImageBytes) return { error: 'tooBig' };
    const info = await call('getFile', { file_id: file.file_id });
    if (!info?.file_path) return { error: 'failed' };
    const { data } = await http.get(`${API}/file/bot${tg.token}/${info.file_path}`, { responseType: 'arraybuffer', timeout: 30_000, maxContentLength: config.maxImageBytes });
    try {
      return { image: decodeImage(Buffer.from(data).toString('base64'), config.maxImageBytes) };
    } catch (err) {
      return { error: err.status === 413 ? 'tooBig' : 'notImage' };
    }
  }

  async function handlePhoto(chatId, msg) {
    if (busy.has(chatId)) return send(chatId, textFor(chatId, (l) => BOT_TEXT[l].busy));
    if (!withinHourlyLimit(chatId)) return send(chatId, textFor(chatId, (l) => BOT_TEXT[l].tooMany));
    while (active >= MAX_CONCURRENT) await sleep(250);
    busy.add(chatId);
    active++;
    const started = Date.now();
    try {
      call('sendChatAction', { chat_id: chatId, action: 'upload_photo' }).catch(() => {});
      const got = await download(msg);
      if (got.error) return send(chatId, textFor(chatId, (l) => BOT_TEXT[l][got.error]), { reply_to_message_id: msg.message_id });
      await send(chatId, textFor(chatId, (l) => BOT_TEXT[l].working), { reply_to_message_id: msg.message_id });
      const daysHung = parseDays(msg.caption) ?? prefs.get(chatId)?.days ?? bot.defaultDays;
      const out = await runPhoneCheck({ config, vision, advisor }, { image: got.image, daysHung, source: 'Telegram photo' });
      // When to act: lifecycle forecast at the farm's default location; the card's catch dates the egg cohort
      let timing = null;
      try {
        const forecast = await weather?.forecast?.({ lat: config.weather.defaultLat, lon: config.weather.defaultLon });
        if (forecast && out.per_day) {
          const mid = new Date(Date.now() - (daysHung / 2) * 86_400_000).toISOString().slice(0, 10);
          timing = predictLifecycle(forecast, { decision: out.decision, days: [{ date: mid, pests: out.per_day.pests }] }).headline;
        }
      } catch {
        /* reply without timing */
      }
      const langs = langsFor(chatId);
      await send(chatId, langs.map((l, k) => resultText(l, out, k === 0 ? timing : null)).join('\n\n— — —\n\n'), { reply_to_message_id: msg.message_id });
      if (out.annotated_image) await sendPhoto(chatId, out.annotated_image, textFor(chatId, (l) => BOT_TEXT[l].caption));
      status.checks++;
      logger?.info('telegram_photo_check', { decision: out.decision.decision, vision: out.vision.status, ms: Date.now() - started });
    } catch (err) {
      logger?.warn('telegram_photo_check_failed', { code: err?.response ? code(err) : err?.code ?? 'error' });
      await send(chatId, textFor(chatId, (l) => BOT_TEXT[l].failed));
    } finally {
      busy.delete(chatId);
      active--;
    }
    return null;
  }

  async function handle(update) {
    if (handled.has(update.update_id)) return;
    handled.add(update.update_id);
    if (handled.size > 2000) handled.delete(handled.values().next().value);
    const msg = update.message ?? update.channel_post;
    if (!msg?.chat) return;
    const chatId = msg.chat.id;
    const key = String(chatId);
    seen.set(key, { id: chatId, type: msg.chat.type, name: msg.chat.title ?? msg.chat.username ?? [msg.chat.first_name, msg.chat.last_name].filter(Boolean).join(' '), at: new Date().toISOString() });
    if (msg.date && Date.now() / 1000 - msg.date > MAX_AGE_S) return; // stale (backend was off)

    const text = (msg.text ?? '').trim();
    if (bot.access !== 'anyone' && !allowed.has(key)) {
      status.refused++;
      // Answer /start (so the farmer learns their id) and photos; ignore other chatter
      if (text.startsWith('/start') || msg.photo || msg.document) await send(chatId, textFor(chatId, (l) => BOT_TEXT[l].notAllowed(key)));
      return;
    }

    if (msg.photo || msg.document) return handlePhoto(chatId, msg);
    const [cmd, arg] = text.split(/\s+/);
    if (cmd === '/days' || cmd?.startsWith('/days@')) {
      const n = parseDays(arg);
      if (n) prefs.set(chatId, { ...prefs.get(chatId), days: n });
      return send(chatId, textFor(chatId, (l) => (n ? BOT_TEXT[l].daysSet(n) : BOT_TEXT[l].help(prefs.get(chatId)?.days ?? bot.defaultDays))));
    }
    if (cmd === '/lang' || cmd?.startsWith('/lang@')) {
      if (['en', 'kn', 'both'].includes(arg)) prefs.set(chatId, { ...prefs.get(chatId), lang: arg });
      return send(chatId, textFor(chatId, (l) => BOT_TEXT[l].langSet));
    }
    // /start, /help or any text: how to use the bot
    return send(chatId, textFor(chatId, (l) => BOT_TEXT[l].help(prefs.get(chatId)?.days ?? bot.defaultDays)));
  }

  async function loop() {
    running = true;
    status.started_at = new Date().toISOString();
    try {
      me = await call('getMe', {});
    } catch (err) {
      const c = code(err);
      if (c === 'telegram_http_401' || c === 'telegram_http_404') {
        status.state = 'bad_token';
        status.last_error = c;
        running = false;
        return;
      }
    }
    while (!stopRequested) {
      try {
        const updates = await call(
          'getUpdates',
          { offset, timeout: bot.pollTimeoutSec, allowed_updates: ['message', 'channel_post'] },
          { timeout: (bot.pollTimeoutSec + 10) * 1000 }
        );
        status.state = 'listening';
        status.last_poll_at = new Date().toISOString();
        status.last_error = null;
        failures = 0;
        for (const u of updates ?? []) {
          offset = Math.max(offset, u.update_id + 1);
          // Photos run in the background so other chats are not kept waiting
          handle(u).catch((err) => logger?.warn('telegram_bot_update_failed', { error: err.message }));
        }
      } catch (err) {
        const c = code(err);
        status.last_error = c;
        if (c === 'telegram_http_409') {
          status.state = 'webhook_conflict'; // another webhook/poller owns this bot
          break;
        }
        if (c === 'telegram_http_401' || c === 'telegram_http_404') {
          status.state = 'bad_token';
          break;
        }
        status.state = 'reconnecting';
        await sleep(BACKOFF_MS[Math.min(failures++, BACKOFF_MS.length - 1)]);
      }
    }
    running = false;
    stopRequested = false;
    if (status.state === 'listening' || status.state === 'reconnecting') status.state = 'stopped';
  }

  return {
    describe: () => ({
      ...status,
      enabled: enabledByConfig,
      running,
      access: bot.access,
      allowed_chats: allowed.size, // count only
      bot: me?.username ?? null,
      max_per_hour: bot.maxPerHour,
      default_days: bot.defaultDays,
    }),
    /** Chats that wrote to the bot (the poller consumes updates, so "Find my chat id" reads these). */
    chats: () => [...seen.values()],
    me: () => (me ? { username: me.username, name: me.first_name ?? null } : null),
    isRunning: () => running,
    start() {
      if (!tg.token || running) return false;
      stopRequested = false;
      loop().catch((err) => logger?.warn('telegram_bot_loop_failed', { error: err.message }));
      return true;
    },
    stop() {
      if (running) stopRequested = true;
      status.state = 'stopped';
      return true;
    },
    /** Test hook: process one update without polling. */
    handle,
  };
}
