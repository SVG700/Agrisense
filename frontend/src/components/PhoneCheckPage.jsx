import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bug, Camera, ImagePlus, Loader2, Minus, Plus, RotateCcw, ScanSearch, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { decisionStyle } from '../lib/decision.js';
import { EASE } from '../lib/motion.jsx';
import Badge from './Badge.jsx';
import DecisionBadge from './DecisionBadge.jsx';
import { decisionReason, useT } from '../lib/i18n.jsx';

const MAX_SIDE = 2600; // keeps 4x4 tiling meaningful while uploads stay small
const DAY_CHIPS = [3, 5, 7, 14];
const TIPS = ['check.tip1', 'check.tip2', 'check.tip3', 'check.tip4'];

/** Phone photo -> JPEG data URL, corrected for orientation and at most MAX_SIDE px. */
async function prepareImage(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Photograph a sticky card, say how long it hung, get counts and a recommendation. */
export default function PhoneCheckPage() {
  const t = useT();
  const [photo, setPhoto] = useState(null); // data URL
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const choose = async (file) => {
    if (!file) return;
    setError(null);
    setResult(null);
    try {
      setPhoto(await prepareImage(file));
    } catch {
      setError(t('check.badFile'));
    }
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.check({ image_base64: photo, days_hung: days }));
    } catch (err) {
      setError(err.status === 429 ? t('check.tooMany') : err.message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setPhoto(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <section className="card flex flex-col gap-5">
        <div>
          <h2 className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <Camera className="h-4 w-4" />
            </span>
            {t('check.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-500">{t('check.intro')}</p>
        </div>

        {/* 1. Photo */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('check.step1')}</div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            id="trap-photo"
            data-testid="photo-input"
            onChange={(e) => choose(e.target.files?.[0])}
          />
          {photo ? (
            <div className="relative overflow-hidden rounded-xl ring-1 ring-slate-200">
              <img src={result?.annotated_image ?? photo} alt="Sticky trap photo" className="max-h-[420px] w-full object-contain bg-white" />
              {!busy && (
                <label htmlFor="trap-photo" className="btn btn-ghost absolute right-2 top-2 cursor-pointer bg-slate-50! text-xs">
                  <ImagePlus className="h-4 w-4" /> {t('check.change')}
                </label>
              )}
            </div>
          ) : (
            <label
              htmlFor="trap-photo"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-4 py-10 text-center transition hover:border-emerald-400/60 hover:bg-emerald-500/5"
            >
              <Camera className="h-10 w-10 text-emerald-700" />
              <span className="font-semibold text-slate-900">{t('check.take')}</span>
              <span className="text-xs text-slate-500">{t('check.takeHint')}</span>
            </label>
          )}
        </div>

        {/* 2. Days hung */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{t('check.step2')}</div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-xl ring-1 ring-slate-200">
              <button className="grid h-11 w-11 place-items-center text-slate-700 disabled:opacity-40" aria-label={t('check.lessDay')} onClick={() => setDays((d) => Math.max(1, d - 1))} disabled={days <= 1}>
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-16 text-center text-lg font-bold tabular-nums text-slate-900" aria-live="polite" data-testid="days-value">
                {t(days === 1 ? 'check.day' : 'check.days', { n: days })}
              </span>
              <button className="grid h-11 w-11 place-items-center text-slate-700 disabled:opacity-40" aria-label={t('check.moreDay')} onClick={() => setDays((d) => Math.min(30, d + 1))} disabled={days >= 30}>
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {DAY_CHIPS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-full px-3 py-1.5 text-sm ring-1 transition ${d === days ? 'bg-emerald-500/20 text-emerald-700 ring-emerald-500/50' : 'text-slate-700 ring-slate-200 hover:bg-slate-100'}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className="btn btn-primary min-h-11 flex-1 justify-center sm:flex-none" onClick={check} disabled={!photo || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            {busy ? t('check.counting') : t('check.button')}
          </button>
          {(photo || result) && !busy && (
            <button className="btn btn-ghost min-h-11" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> {t('check.again')}
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="flex gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-500/30">
            <TriangleAlert className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
      </section>

      <AnimatePresence>{result && <CheckResult key="result" result={result} />}</AnimatePresence>

      {!result && (
        <section className="card text-sm text-slate-500">
          <div className="mb-2 font-semibold text-slate-800">{t('check.tipsTitle')}</div>
          <ul className="list-disc space-y-1 pl-5">
            {TIPS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CheckResult({ result }) {
  const t = useT();
  const d = result.decision;
  const style = decisionStyle(d?.decision);
  const counts = result.counts ?? {};
  const fallback = result.vision?.fallback;
  const q = result.quality;
  const adv = result.advisory;
  const [lo, hi] = d?.range?.pests ?? [];
  const resultRef = useRef(null);
  useEffect(() => {
    // Braces matter: newer Chrome returns a Promise from scrollIntoView, and an effect must return nothing
    resultRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <motion.section
      ref={resultRef}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={`card flex scroll-mt-4 flex-col gap-4 ring-1 ${style?.panel ?? 'ring-slate-200'}`}
      data-testid="check-result"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-slate-500">{t('check.whatToDo')}</span>
        <DecisionBadge decision={d?.decision} borderline={d?.borderline} size="lg" />
      </div>
      {d?.reason && <p className="text-sm leading-relaxed text-slate-800">{decisionReason(t.lang, d)}</p>}

      {(fallback || result.vision?.status === 'simulated') && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-500/30">
          <Badge tone="warn">{t('simulatedData')}</Badge>
          <Badge tone="warn">{t('demoDetector')}</Badge>
          {fallback?.message ?? 'These counts come from the demo detector.'}
        </div>
      )}

      {result.counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t('check.whiteflies')} value={counts.whitefly ?? result.totals?.pests ?? 0} />
          <Stat label={t('check.predators')} value={result.totals?.predators ?? 0} sub={`MR ${counts.macrolophus ?? 0} · NC ${counts.nesidiocoris ?? 0}`} />
          <Stat label={t('check.pestsPerDay')} value={result.per_day?.pests ?? '—'} sub={lo !== undefined ? t('check.range', { lo, hi }) : t('check.over', { n: result.days_hung })} />
          <Stat label={t('check.perPredator')} value={d?.no_predators ? t('check.noPredators') : d?.pests_per_predator ?? '—'} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {q && (q.ok ? <Badge tone="good">{t('check.qualityOk')}</Badge> : <Badge tone="bad">{t('check.qualityBad', { issues: q.issues.map((i) => t(`issue.${i}`)).join(', ') })}</Badge>)}
        {result.vision?.status === 'ok' && (
          <Badge tone="good">
            <Bug className="h-3 w-3" /> {result.vision.boxes} detections · {result.vision.model}
            {result.vision.image?.grid ? ` · ${result.vision.image.grid} tiles` : ''}
          </Badge>
        )}
        {d?.thresholds && (
          <Badge tone="muted" title="Placeholder thresholds, to confirm with the ICAR-IIHR mentor">
            {t('check.actionLevel', { t: d.thresholds.action_threshold_per_day, r: d.thresholds.spray_ratio })}
          </Badge>
        )}
      </div>

      {adv?.recommendation && (
        <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5" /> {t('check.advice')}{' '}
            <span className="font-normal normal-case tracking-normal text-slate-500">
              ({adv.source === 'gemini' ? 'Gemini' : adv.source === 'claude' ? 'Claude' : 'rule engine'}) {t('check.englishNote')}
            </span>
          </div>
          <ol className="ml-5 list-decimal space-y-1 text-sm text-slate-800">
            {(adv.mitigation_strategy?.length ? adv.mitigation_strategy : [adv.recommendation]).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-[11px] text-slate-500">{t('check.disclaimer')}</p>
    </motion.section>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
