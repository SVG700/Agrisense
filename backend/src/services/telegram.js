/**
 * Telegram: daily trap summary + instant alerts, in English and Kannada.
 *
 *   summary  every trap's traffic-light decision (pests/day, per predator,
 *            BORDERLINE, simulated) + the spray window, at TELEGRAM_SUMMARY_TIME
 *   alert    when a trap's advice changes to SPRAY / RELEASE BIOCONTROL /
 *            CHECK TRAP (once per trap and decision per 6 h)
 *
 * Bot API over HTTPS from the backend only. The token sits in the URL path, so
 * failures are reduced to a status code before anything is logged - the token
 * never reaches logs, responses or the browser. Sending never blocks ingestion.
 * Kannada wording is a first draft: have a native speaker / IIHR review it.
 */
import axios from 'axios';
import { trapDecision } from '../routes/map.js';

const API = 'https://api.telegram.org';
const MAX_LEN = 3900; // Telegram limit is 4096; keep a margin for HTML
const ALERT_DECISIONS = ['SPRAY', 'BIOCONTROL', 'CHECK_TRAP'];
const ALERT_REPEAT_MS = 6 * 3_600_000;

const ICON = { SPRAY: '🔴▲', BIOCONTROL: '🟠◆', WAIT: '🟢●', CHECK_TRAP: '⚪■' };

/** All user-facing text, per language. */
export const TEXT = {
  en: {
    decision: { SPRAY: 'SPRAY', BIOCONTROL: 'RELEASE BIOCONTROL', WAIT: 'WAIT', CHECK_TRAP: 'CHECK TRAP' },
    title: 'AgriSense trap summary',
    pestsPerDay: (n) => `${n} pests/day`,
    perPredator: (n) => `${n} per predator`,
    noPredators: 'no predators',
    noData: 'no counted photos yet',
    borderline: 'BORDERLINE',
    simulated: 'simulated',
    sprayYes: 'Spray window: conditions are good now.',
    sprayNo: (next) => `Spray window: not now. Next good window: ${next}.`,
    noWindow: 'no good window in the next 3 days',
    weatherOff: 'Spray window: weather unavailable.',
    footer: 'Decision support only - scout the crop before treating. Thresholds are placeholders.',
    alertTitle: 'Trap alert',
    changed: (trap, prev, now) => `${trap}: advice changed from ${prev} to ${now}`,
    became: (trap, now) => `${trap}: advice is now ${now}`,
    open: 'Open dashboard',
    test: 'AgriSense is connected. Trap alerts and a daily summary will arrive here.',
  },
  kn: {
    decision: { SPRAY: 'ಸಿಂಪಡಿಸಿ', BIOCONTROL: 'ಜೈವಿಕ ನಿಯಂತ್ರಕ ಬಿಡುಗಡೆ ಮಾಡಿ', WAIT: 'ಕಾಯಿರಿ', CHECK_TRAP: 'ಬಲೆಯನ್ನು ಪರಿಶೀಲಿಸಿ' },
    title: 'ಅಗ್ರಿಸೆನ್ಸ್ ಬಲೆ ಸಾರಾಂಶ',
    pestsPerDay: (n) => `ದಿನಕ್ಕೆ ${n} ಕೀಟಗಳು`,
    perPredator: (n) => `ಪ್ರತಿ ಪರಭಕ್ಷಕಕ್ಕೆ ${n}`,
    noPredators: 'ಪರಭಕ್ಷಕಗಳಿಲ್ಲ',
    noData: 'ಇನ್ನೂ ಎಣಿಸಿದ ಚಿತ್ರಗಳಿಲ್ಲ',
    borderline: 'ಗಡಿರೇಖೆಯಲ್ಲಿದೆ',
    simulated: 'ಅನುಕರಿಸಿದ ದತ್ತಾಂಶ',
    sprayYes: 'ಸಿಂಪಡಣೆ: ಈಗ ಹವಾಮಾನ ಸೂಕ್ತವಾಗಿದೆ.',
    sprayNo: (next) => `ಸಿಂಪಡಣೆ: ಈಗ ಬೇಡ. ಮುಂದಿನ ಸೂಕ್ತ ಸಮಯ: ${next}.`,
    noWindow: 'ಮುಂದಿನ 3 ದಿನಗಳಲ್ಲಿ ಸೂಕ್ತ ಸಮಯವಿಲ್ಲ',
    weatherOff: 'ಸಿಂಪಡಣೆ: ಹವಾಮಾನ ಮಾಹಿತಿ ಲಭ್ಯವಿಲ್ಲ.',
    footer: 'ಇದು ನಿರ್ಧಾರಕ್ಕೆ ಸಹಾಯ ಮಾತ್ರ - ಔಷಧಿ ಬಳಸುವ ಮೊದಲು ಬೆಳೆಯನ್ನು ಪರಿಶೀಲಿಸಿ.',
    alertTitle: 'ಬಲೆ ಎಚ್ಚರಿಕೆ',
    changed: (trap, prev, now) => `${trap}: ಸಲಹೆ ${prev} ಇಂದ ${now} ಗೆ ಬದಲಾಗಿದೆ`,
    became: (trap, now) => `${trap}: ಈಗಿನ ಸಲಹೆ ${now}`,
    open: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ತೆರೆಯಿರಿ',
    test: 'ಅಗ್ರಿಸೆನ್ಸ್ ಸಂಪರ್ಕಗೊಂಡಿದೆ. ಬಲೆ ಎಚ್ಚರಿಕೆಗಳು ಮತ್ತು ದೈನಂದಿನ ಸಾರಾಂಶ ಇಲ್ಲಿ ಬರುತ್ತವೆ.',
  },
};

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const label = (lang, d) => TEXT[lang].decision[d] ?? d ?? '-';

/** Splits on line breaks so no message exceeds Telegram's limit. */
export function chunk(text, max = MAX_LEN) {
  const out = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > max) {
      out.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line.slice(0, max);
  }
  if (cur) out.push(cur);
  return out;
}

/** One trap line in one language. */
function trapLine(lang, name, d) {
  const t = TEXT[lang];
  const head = `${ICON[d.decision] ?? '•'} <b>${esc(name)}</b>: ${esc(label(lang, d.decision))}`;
  if (!d.decision || d.check_trap) return d.decision ? head : `• <b>${esc(name)}</b>: ${t.noData}`;
  const bits = [t.pestsPerDay(d.avg_pests), d.no_predators ? t.noPredators : t.perPredator(d.pests_per_predator)];
  if (d.borderline) bits.push(t.borderline);
  if (d.simulated) bits.push(t.simulated);
  return `${head} - ${bits.join(', ')}`;
}

function sprayLine(lang, weather, fmtWindow) {
  const t = TEXT[lang];
  if (!weather?.available) return t.weatherOff;
  if (weather.spray.can_spray_now) return t.sprayYes;
  return t.sprayNo(weather.spray.next_window ? fmtWindow(weather.spray.next_window) : t.noWindow);
}

/**
 * Builds the summary text (HTML) for the given languages.
 * @param {{name: string, decision: object}[]} traps
 */
export function summaryText({ traps, weather, languages, date, fmtWindow, dashboardUrl }) {
  const blocks = languages.map((lang) => {
    const t = TEXT[lang];
    const lines = [`🌿 <b>${t.title}</b> - ${esc(date)}`, ''];
    for (const tr of traps) lines.push(trapLine(lang, tr.name, tr.decision));
    lines.push('', `🌦 ${sprayLine(lang, weather, fmtWindow)}`, `<i>${t.footer}</i>`);
    return lines.join('\n');
  });
  if (dashboardUrl) blocks.push(`🔗 <a href="${esc(dashboardUrl)}">${TEXT[languages[0]].open}</a>`);
  return blocks.join('\n\n────────────\n\n');
}

export function alertText({ name, previous, decision, languages, dashboardUrl }) {
  const blocks = languages.map((lang) => {
    const t = TEXT[lang];
    const now = `${ICON[decision.decision] ?? ''} ${label(lang, decision.decision)}`;
    const head = previous && previous !== decision.decision ? t.changed(esc(name), label(lang, previous), now) : t.became(esc(name), now);
    const lines = [`🚨 <b>${t.alertTitle}</b>`, head];
    // The engine's reason is English; the Kannada block shows the numbers instead
    if (lang === 'en' && decision.reason) lines.push(esc(decision.reason));
    else if (decision.avg_pests != null) lines.push(trapLine(lang, name, decision));
    return lines.join('\n');
  });
  if (dashboardUrl) blocks.push(`🔗 <a href="${esc(dashboardUrl)}">${TEXT[languages[0]].open}</a>`);
  return blocks.join('\n\n');
}

/**
 * @param {{config, store, weather?, http?, logger?}} deps
 */
export function createTelegram({ config, store, weather, http = axios, logger }) {
  const tg = config.telegram;
  const configured = Boolean(tg.token && tg.chatIds.length);
  const languages = tg.language === 'both' ? ['en', 'kn'] : [tg.language];
  const lastAlert = new Map(); // `${deviceId}|${decision}` -> ms
  let lastSummaryDay = null;
  let lastResult = null;

  const zoned = (iso, opts) => new Intl.DateTimeFormat('en-IN', { timeZone: tg.timezone, ...opts }).format(new Date(iso));
  const fmtWindow = (w) => `${zoned(w.start, { weekday: 'short', day: 'numeric', month: 'short' })} ${zoned(w.start, { hour: '2-digit', minute: '2-digit', hour12: false })}-${zoned(w.end, { hour: '2-digit', minute: '2-digit', hour12: false })}`;

  /** Telegram error -> stable code (never the URL, which contains the token). */
  const errorCode = (err) =>
    err?.response?.status ? `telegram_http_${err.response.status}` : err?.code === 'ECONNABORTED' ? 'telegram_timeout' : 'telegram_unreachable';

  async function send(text) {
    if (!configured) return { ok: false, code: 'not_configured' };
    let sent = 0;
    try {
      for (const chatId of tg.chatIds) {
        for (const part of chunk(text)) {
          await http.post(
            `${API}/bot${tg.token}/sendMessage`,
            { chat_id: chatId, text: part, parse_mode: 'HTML', disable_web_page_preview: true },
            { timeout: tg.timeoutMs }
          );
          sent++;
        }
      }
      lastResult = { ok: true, at: new Date().toISOString(), messages: sent };
      return lastResult;
    } catch (err) {
      const code = errorCode(err);
      logger?.warn('telegram_failed', { code, description: err?.response?.data?.description });
      lastResult = { ok: false, at: new Date().toISOString(), code, description: err?.response?.data?.description ?? null, messages: sent };
      return lastResult;
    }
  }

  async function buildSummary() {
    const devices = await store.listDevices();
    const traps = [];
    for (const d of devices) traps.push({ name: d.name, decision: await trapDecision({ store }, d.id) });
    // Most urgent first
    const order = { SPRAY: 0, CHECK_TRAP: 1, BIOCONTROL: 2, WAIT: 3 };
    traps.sort((a, b) => (order[a.decision.decision] ?? 4) - (order[b.decision.decision] ?? 4) || a.name.localeCompare(b.name));
    const w = weather
      ? await weather.forLocation({ lat: config.weather.defaultLat, lon: config.weather.defaultLon, label: config.weather.defaultLabel })
      : null;
    const date = zoned(new Date().toISOString(), { day: 'numeric', month: 'short', year: 'numeric' });
    return summaryText({ traps, weather: w, languages, date, fmtWindow, dashboardUrl: tg.dashboardUrl });
  }

  return {
    describe: () => ({
      state: configured ? 'configured' : tg.token ? 'missing_chat_id' : 'not_configured',
      chats: tg.chatIds.length, // count only
      language: tg.language,
      alerts: tg.alerts,
      summary_time: tg.summaryTime || null,
      timezone: tg.timezone,
      last: lastResult,
    }),

    sendTest: () => send(languages.map((l) => `✅ ${TEXT[l].test}`).join('\n\n')),

    async sendSummary() {
      return send(await buildSummary());
    },

    buildSummary,

    /**
     * Called after each capture is stored. Never throws, never awaited by ingestion.
     * @param {{device: {id, name}, previous?: string|null, decision: object}} e
     */
    async onDecision({ device, previous, decision }) {
      if (!configured || !tg.alerts || !decision?.decision) return null;
      if (!ALERT_DECISIONS.includes(decision.decision) || previous === decision.decision) return null;
      const key = `${device.id}|${decision.decision}`;
      if (Date.now() - (lastAlert.get(key) ?? 0) < ALERT_REPEAT_MS) return null;
      lastAlert.set(key, Date.now());
      return send(alertText({ name: device.name, previous, decision, languages, dashboardUrl: tg.dashboardUrl }));
    },

    /** Chats that have messaged the bot recently - to find TELEGRAM_CHAT_ID. Works with only the token set. */
    async findChats() {
      if (!tg.token) return { ok: false, code: 'not_configured', chats: [] };
      // Which bot this token belongs to, so the farmer knows exactly whom to message
      let bot = null;
      try {
        const { data } = await http.get(`${API}/bot${tg.token}/getMe`, { timeout: tg.timeoutMs });
        if (data?.result?.username) bot = { username: data.result.username, name: data.result.first_name ?? null };
      } catch (err) {
        const code = errorCode(err);
        const description = err?.response?.data?.description ?? null;
        // 401/404 here means the token itself is wrong - no point asking Telegram for chats
        if (code === 'telegram_http_401' || code === 'telegram_http_404') return { ok: false, code, description, chats: [], bot: null };
      }
      try {
        const { data } = await http.get(`${API}/bot${tg.token}/getUpdates`, { timeout: tg.timeoutMs, params: { limit: 50 } });
        const chats = new Map();
        for (const u of data?.result ?? []) {
          const c = (u.message ?? u.channel_post ?? u.my_chat_member ?? u.edited_message)?.chat;
          if (c) chats.set(c.id, { id: c.id, type: c.type, name: c.title ?? c.username ?? [c.first_name, c.last_name].filter(Boolean).join(' ') });
        }
        return { ok: true, chats: [...chats.values()], bot };
      } catch (err) {
        return { ok: false, code: errorCode(err), description: err?.response?.data?.description ?? null, chats: [], bot };
      }
    },

    /** Daily summary at tg.summaryTime (checked every minute). Returns a stop function. */
    startScheduler() {
      if (!configured || !tg.summaryTime) return () => {};
      const timer = setInterval(async () => {
        const now = new Date().toISOString();
        const hhmm = zoned(now, { hour: '2-digit', minute: '2-digit', hour12: false });
        const day = zoned(now, { year: 'numeric', month: '2-digit', day: '2-digit' });
        if (hhmm !== tg.summaryTime || lastSummaryDay === day) return;
        lastSummaryDay = day;
        try {
          const r = await this.sendSummary();
          logger?.info('telegram_daily_summary', { ok: r.ok, code: r.code });
        } catch (err) {
          logger?.warn('telegram_summary_failed', { error: err.message });
        }
      }, 60_000);
      timer.unref?.();
      return () => clearInterval(timer);
    },
  };
}
