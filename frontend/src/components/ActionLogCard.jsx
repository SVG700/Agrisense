import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardCheck, Hourglass, Loader2, SprayCan, Undo2, Users } from 'lucide-react';
import { api } from '../api.js';
import { EASE } from '../lib/motion.jsx';
import { timeAgo } from '../lib/pests.js';
import DecisionBadge from './DecisionBadge.jsx';
import { useT } from '../lib/i18n.jsx';

/** The three things a farmer can report after reading the advice (colours match the chart markers). */
export const ACTION_TYPES = {
  sprayed: { label: 'Sprayed', icon: SprayCan, color: '#f43f5e', tone: 'text-rose-700 ring-rose-500/40 hover:bg-rose-500/10' },
  released: { label: 'Released predators', icon: Users, color: '#f59e0b', tone: 'text-amber-800 ring-amber-500/40 hover:bg-amber-500/10' },
  not_yet: { label: 'Not yet', icon: Hourglass, color: '#94a3b8', tone: 'text-slate-700 ring-slate-500/40 hover:bg-slate-500/10' },
};

/**
 * "What did you do?" - log Sprayed / Released / Not yet against the current
 * advice. Entries appear as markers on the trap chart. Writing needs the admin
 * key (like other dashboard writes); reading is open.
 */
export default function ActionLogCard({ deviceId, decision, actions, unavailable, onChanged }) {
  const t = useT();
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState(null);

  const log = async (action) => {
    setBusy(action);
    setError(null);
    try {
      await api.logAction({ device_id: deviceId, action, note: note.trim() || undefined });
      setNote('');
      await onChanged?.();
    } catch (err) {
      setError(err.status === 401 || err.status === 403 ? 'Enter the admin key in Admin & Hardware Control to log actions.' : err.message);
    } finally {
      setBusy(null);
    }
  };

  const undo = async (id) => {
    setBusy('undo');
    setError(null);
    try {
      await api.deleteAction(id);
      await onChanged?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card flex flex-col gap-4" data-testid="action-log">
      <div>
        <h2 className="card-title">
          <span className="icon-chip h-8! w-8! rounded-lg!">
            <ClipboardCheck className="h-4 w-4" />
          </span>
          {t('actions.title')}
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {t('actions.subtitle')}
          {decision?.decision && <DecisionBadge decision={decision.decision} size="sm" />}
        </p>
      </div>

      {unavailable ? (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-500/30">{unavailable}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(ACTION_TYPES).map(([id, type]) => {
              const Icon = type.icon;
              return (
                <button
                  key={id}
                  onClick={() => log(id)}
                  disabled={!deviceId || busy !== null}
                  className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-center text-xs font-semibold ring-1 transition disabled:opacity-50 ${type.tone}`}
                >
                  {busy === id ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
                  {t(`actions.${id}`)}
                </button>
              );
            })}
          </div>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 280))}
            placeholder={t('actions.note')}
            className="field px-3 py-2 text-sm"
            aria-label="Note"
          />
        </>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}

      {actions.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {actions.slice(0, 5).map((a, i) => {
              const type = ACTION_TYPES[a.action] ?? ACTION_TYPES.not_yet;
              const Icon = type.icon;
              return (
                <motion.li
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE }}
                  className="flex items-start gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs ring-1 ring-slate-200"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: type.color }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <b className="text-slate-900">{t(`actions.${a.action}`)}</b>
                      {a.decision && (
                        <span className="flex items-center gap-1 text-slate-500">
                          {t('actions.adviceWas')} <DecisionBadge decision={a.decision} size="sm" />
                        </span>
                      )}
                      <span className="text-slate-500">· {timeAgo(a.acted_at)}</span>
                    </div>
                    {a.note && <div className="mt-0.5 truncate text-slate-500">{a.note}</div>}
                  </div>
                  {i === 0 && (
                    <button onClick={() => undo(a.id)} disabled={busy !== null} className="text-slate-500 hover:text-slate-800" title="Undo this entry" aria-label="Undo last action">
                      <Undo2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
