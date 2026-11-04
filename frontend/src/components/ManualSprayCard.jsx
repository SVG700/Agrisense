import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Droplets, Send, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { EASE } from '../lib/motion.jsx';
import { useT } from '../lib/i18n.jsx';

/**
 * "Manual spray": one button that logs a spray for this trap and sends a
 * Telegram message to the farm group (POST /api/actions with notify: true).
 * Asks for confirmation first, and warns when the current advice is not SPRAY.
 */
export default function ManualSprayCard({ device, decision, onChanged }) {
  const t = useT();
  const [step, setStep] = useState('idle'); // idle | confirm | sending
  const [note, setNote] = useState('');
  const [result, setResult] = useState(null); // {tone, text}
  useEffect(() => {
    setStep('idle');
    setResult(null);
  }, [device?.id]);

  if (!device) return null;
  const advice = decision?.decision ?? null;
  const notAdvised = advice && advice !== 'SPRAY';

  const send = async () => {
    setStep('sending');
    try {
      const r = await api.logAction({ device_id: device.id, action: 'sprayed', note: note.trim() || undefined, notify: true });
      setResult(
        r.telegram?.ok
          ? { tone: 'good', text: t('spray.sent') }
          : { tone: 'warn', text: t('spray.notSent', { code: r.telegram?.code ?? 'telegram_failed' }) }
      );
      setNote('');
      onChanged?.();
    } catch (err) {
      setResult({ tone: 'bad', text: err.message });
    } finally {
      setStep('idle');
    }
  };

  const TONE = {
    good: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
    warn: 'bg-amber-50 text-amber-900 ring-amber-200',
    bad: 'bg-rose-50 text-rose-800 ring-rose-200',
  };

  return (
    <section className="card card-hover flex flex-col gap-4" aria-labelledby="spray-title">
      <div className="flex items-start gap-3">
        <span className="icon-chip h-9! w-9! shrink-0">
          <Droplets className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 id="spray-title" className="card-title">
            {t('spray.title')}
          </h2>
          <p className="mt-0.5 text-sm text-slate-600">{t('spray.help')}</p>
        </div>
      </div>

      {step === 'idle' ? (
          <div>
            <button className="btn btn-brand w-full" onClick={() => { setResult(null); setStep('confirm'); }}>
              <Droplets className="h-4 w-4" aria-hidden="true" /> {t('spray.button')}
            </button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            className="flex flex-col gap-3 rounded-xl bg-canvas p-3 ring-1 ring-line"
          >
            <p className="text-sm font-medium text-ink">{t('spray.ask', { trap: device.name })}</p>
            {notAdvised && (
              <p className="flex gap-2 text-sm text-amber-900">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t('spray.warn', { advice: t(`decision.${advice}`) })}
              </p>
            )}
            <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
              {t('spray.note')}
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={280}
                className="field px-3 py-2 text-sm font-normal"
                placeholder="e.g. rows 1-4, neem oil"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-brand" onClick={send} disabled={step === 'sending'}>
                <Send className="h-4 w-4" aria-hidden="true" /> {t('spray.confirm')}
              </button>
              <button className="btn btn-ghost" onClick={() => setStep('idle')} disabled={step === 'sending'}>
                {t('spray.cancel')}
              </button>
            </div>
          </motion.div>
        )}

      {result && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm ring-1 ${TONE[result.tone]}`}>
          {result.text}
        </p>
      )}
    </section>
  );
}
