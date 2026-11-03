import { useEffect, useState } from 'react';
import { Eye, Loader2, MessageCircle, Search, Send } from 'lucide-react';
import { api } from '../api.js';
import Badge from './Badge.jsx';

const STATE = {
  configured: { tone: 'good', label: 'Connected' },
  missing_chat_id: { tone: 'warn', label: 'Token set - chat id missing' },
  not_configured: { tone: 'muted', label: 'Not set up' },
};

/** Telegram summaries + alerts (English + Kannada): status, preview, test, send now, find chat id. */
export default function TelegramCard({ log }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  const [chats, setChats] = useState(null);
  const [bot, setBot] = useState(null);

  const loadStatus = () => api.telegramStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => {
    loadStatus();
  }, []);

  const run = async (kind, fn, ok) => {
    setBusy(kind);
    try {
      const r = await fn();
      ok?.(r);
    } catch (err) {
      log?.(`Telegram ${kind}: ${err.status === 401 || err.status === 403 ? 'admin key required - enter it above' : err.message}`, 'error');
    } finally {
      setBusy(null);
      loadStatus();
    }
  };

  const st = STATE[status?.state] ?? STATE.not_configured;
  const ready = status?.state === 'configured';

  return (
    <section className="card flex flex-col gap-4" data-testid="telegram-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <MessageCircle className="h-4 w-4" />
            </span>
            Telegram alerts
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            A daily trap summary{status?.summary_time ? ` at ${status.summary_time} (${status.timezone})` : ''} and an instant alert when a
            trap turns SPRAY, RELEASE BIOCONTROL or CHECK TRAP - in English and ಕನ್ನಡ.
          </p>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>

      {!ready && (
        <ol className="list-decimal space-y-1 rounded-lg bg-slate-900/60 p-3 pl-7 text-xs text-slate-300 ring-1 ring-slate-800">
          <li>
            In Telegram, open <b>@BotFather</b>, send <code>/newbot</code>, copy the token into <code>TELEGRAM_BOT_TOKEN</code> in backend/.env.
          </li>
          <li>Send any message to your new bot (or add it to your group), restart the backend, then press <b>Find my chat id</b>.</li>
          <li>
            Put that number in <code>TELEGRAM_CHAT_ID</code>, restart, and press <b>Send test</b>.
          </li>
        </ol>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-ghost text-xs" onClick={() => run('preview', api.telegramPreview, (r) => setPreview(r.text))} disabled={busy !== null}>
          {busy === 'preview' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Preview summary
        </button>
        <button
          className="btn btn-ghost text-xs"
          onClick={() => run('chat lookup', api.telegramChats, (r) => (setChats(r.chats), setBot(r.bot ?? null)))}
          disabled={busy !== null || status?.state === 'not_configured'}
        >
          {busy === 'chat lookup' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />} Find my chat id
        </button>
        <button className="btn btn-ghost text-xs" onClick={() => run('test', api.telegramTest, () => log?.('Telegram test message sent'))} disabled={busy !== null || !ready}>
          {busy === 'test' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send test
        </button>
        <button className="btn btn-primary text-xs" onClick={() => run('summary', api.telegramSummary, () => log?.('Telegram summary sent'))} disabled={busy !== null || !ready}>
          {busy === 'summary' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send summary now
        </button>
      </div>

      {chats && (
        <div className="text-xs text-slate-300">
          {chats.length ? (
            <ul className="space-y-1">
              {bot && <li className="text-slate-400">Bot: @{bot.username} - copy your number below into TELEGRAM_CHAT_ID:</li>}
              {chats.map((c) => (
                <li key={c.id}>
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-emerald-200">{c.id}</code> {c.name} ({c.type})
                </li>
              ))}
            </ul>
          ) : (
            <p data-testid="telegram-no-chats">
              No messages found for{' '}
              {bot ? (
                <a href={`https://t.me/${bot.username}`} target="_blank" rel="noreferrer" className="font-semibold text-emerald-300 underline">
                  @{bot.username}
                </a>
              ) : (
                'your bot'
              )}{' '}
              yet. Open {bot ? `@${bot.username}` : 'the bot'} in Telegram (not @BotFather), press <b>Start</b>, send "hi", then click{' '}
              <b>Find my chat id</b> again.
            </p>
          )}
        </div>
      )}

      {status?.last && (
        <p className={`text-xs ${status.last.ok ? 'text-slate-500' : 'text-rose-300'}`}>
          Last send: {status.last.ok ? `OK (${status.last.messages} message${status.last.messages === 1 ? '' : 's'})` : `failed - ${status.last.description ?? status.last.code}`} ·{' '}
          {new Date(status.last.at).toLocaleTimeString()}
        </p>
      )}

      {preview && (
        <div
          className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-950/70 p-3 text-xs leading-relaxed text-slate-200 ring-1 ring-slate-800"
          data-testid="telegram-preview"
          // Server-built Telegram HTML (escaped names; only <b>, <i>, <a>): shown as plain text here
        >
          {preview.replace(/<[^>]+>/g, '')}
        </div>
      )}
    </section>
  );
}
