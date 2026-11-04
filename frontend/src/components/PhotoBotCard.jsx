import { useCallback, useEffect, useState } from 'react';
import { Bot, Camera, Loader2, Power, ShieldCheck } from 'lucide-react';
import { api } from '../api.js';
import Badge from './Badge.jsx';
import { timeAgo } from '../lib/pests.js';

const POLL_MS = 10_000;
const STATE = {
  listening: { tone: 'good', label: 'Listening for photos' },
  reconnecting: { tone: 'warn', label: 'Reconnecting to Telegram' },
  starting: { tone: 'warn', label: 'Starting' },
  stopped: { tone: 'muted', label: 'Stopped' },
  off: { tone: 'muted', label: 'Off' },
  webhook_conflict: { tone: 'bad', label: 'Blocked by a webhook' },
  bad_token: { tone: 'bad', label: 'Bot token rejected' },
};
const HELP = {
  reconnecting: 'Telegram cannot be reached from this network right now - the bot keeps retrying. On venue Wi-Fi that blocks Telegram, switch the laptop to mobile data.',
  webhook_conflict: 'Another app has a webhook on this bot. Remove it (BotFather or deleteWebhook) and press Start.',
  bad_token: 'Copy the token from @BotFather into TELEGRAM_BOT_TOKEN in backend/.env and restart the backend.',
};

/**
 * Photo bot: farmers send a trap photo to the Telegram bot and get the count,
 * decision and next steps back. Status, counters and start / stop.
 */
export default function PhotoBotCard({ log }) {
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = useCallback(() => {
    api
      .telegramBot()
      .then((r) => (setS(r), setErr(null)))
      .catch((e) => setErr(e.status === 401 || e.status === 403 ? 'Enter the admin key above to see the photo bot.' : e.message));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const toggle = async () => {
    setBusy(true);
    try {
      const r = await api.setTelegramBot(!s?.running);
      setS(r);
      log?.(`Photo bot ${r.running ? 'started' : 'stopped'}`);
    } catch (e) {
      log?.(`Photo bot: ${e.message}`, 'error');
    } finally {
      setBusy(false);
      setTimeout(load, 1500);
    }
  };

  const st = STATE[s?.state] ?? STATE.off;

  return (
    <section className="card flex flex-col gap-4" data-testid="photo-bot-card" aria-labelledby="photobot-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="photobot-title" className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <Bot className="h-4 w-4" aria-hidden="true" />
            </span>
            Photo bot (Telegram)
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Farmers send a sticky-trap photo to {s?.bot ? <b className="text-ink">@{s.bot}</b> : 'the bot'} - with the days it hung as the caption
            - and get the insect count, the decision, what to do and the marked-up photo back. Nothing is stored.
          </p>
        </div>
        <Badge tone={st.tone}>
          {s?.state === 'listening' && <span className="live-dot mr-1 text-emerald-500" aria-hidden="true" />}
          {st.label}
        </Badge>
      </div>

      {err && <p className="text-sm text-slate-500">{err}</p>}

      {s && (
        <>
          {HELP[s.state] && <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-200">{HELP[s.state]}</p>}
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat icon={Camera} label="Photos checked" value={s.checks} />
            <Stat icon={ShieldCheck} label="Who can use it" value={s.access === 'anyone' ? 'Anyone' : `${s.allowed_chats} chat${s.allowed_chats === 1 ? '' : 's'}`} />
            <Stat label="Refused" value={s.refused} />
            <Stat label="Last check-in" value={s.last_poll_at ? timeAgo(s.last_poll_at) : '—'} />
          </dl>
          <p className="text-xs text-slate-500">
            Limits: {s.max_per_hour} photos per chat per hour, one at a time. Without a number in the caption the card is taken to have hung{' '}
            {s.default_days} days. Unknown chats get their chat id to send you (add it to TELEGRAM_CHAT_ID).
          </p>
          <div>
            <button type="button" onClick={toggle} disabled={busy || !s.enabled} className={`btn ${s.running ? 'btn-ghost' : 'btn-primary'}`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Power className="h-4 w-4" aria-hidden="true" />}
              {s.running ? 'Stop photo bot' : 'Start photo bot'}
            </button>
            {!s.enabled && <span className="ml-3 text-xs text-slate-500">Turned off with TELEGRAM_PHOTO_BOT=false.</span>}
          </div>
        </>
      )}
    </section>
  );
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl p-3 ring-1 ring-line">
      <dt className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </dt>
      <dd className="mt-0.5 font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
