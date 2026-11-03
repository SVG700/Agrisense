import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bug, Camera, ImagePlus, Loader2, Minus, Plus, RotateCcw, ScanSearch, ShieldCheck, TriangleAlert } from 'lucide-react';
import { api } from '../api.js';
import { decisionStyle } from '../lib/decision.js';
import { EASE } from '../lib/motion.jsx';
import Badge from './Badge.jsx';
import DecisionBadge from './DecisionBadge.jsx';

const MAX_SIDE = 2600; // keeps 4x4 tiling meaningful while uploads stay small
const DAY_CHIPS = [3, 5, 7, 14];
const ISSUE_LABELS = { blurry: 'blurry', dark: 'too dark', bright: 'overexposed', glare: 'glare' };
const TIPS = [
  'Hold the phone about 30 cm from the card, straight on.',
  'Use daylight; avoid shadows and direct sun on the card.',
  'Tilt slightly if the shiny card reflects light.',
  'Fill the photo with the card and tap to focus.',
];

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
      setError('That file could not be opened as a photo. Try a JPEG or PNG.');
    }
  };

  const check = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.check({ image_base64: photo, days_hung: days }));
    } catch (err) {
      setError(err.status === 429 ? 'Too many checks in a short time. Please wait a minute and try again.' : err.message);
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
            Check a sticky trap with your phone
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Photograph the yellow card and tell us how many days it hung. You get the insect count and what to do. Nothing is
            saved.
          </p>
        </div>

        {/* 1. Photo */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">1. Photo of the card</div>
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
            <div className="relative overflow-hidden rounded-xl ring-1 ring-slate-700">
              <img src={result?.annotated_image ?? photo} alt="Sticky trap photo" className="max-h-[420px] w-full object-contain bg-slate-950" />
              {!busy && (
                <label htmlFor="trap-photo" className="btn btn-ghost absolute right-2 top-2 cursor-pointer bg-slate-900/80! text-xs">
                  <ImagePlus className="h-4 w-4" /> Change
                </label>
              )}
            </div>
          ) : (
            <label
              htmlFor="trap-photo"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-600 px-4 py-10 text-center transition hover:border-emerald-400/60 hover:bg-emerald-500/5"
            >
              <Camera className="h-10 w-10 text-emerald-300" />
              <span className="font-semibold text-white">Take or choose a photo</span>
              <span className="text-xs text-slate-400">On a phone this opens the camera</span>
            </label>
          )}
        </div>

        {/* 2. Days hung */}
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">2. How many days did the card hang?</div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-xl ring-1 ring-slate-700">
              <button className="grid h-11 w-11 place-items-center text-slate-300 disabled:opacity-40" aria-label="One day less" onClick={() => setDays((d) => Math.max(1, d - 1))} disabled={days <= 1}>
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-16 text-center text-lg font-bold tabular-nums text-white" aria-live="polite" data-testid="days-value">
                {days} {days === 1 ? 'day' : 'days'}
              </span>
              <button className="grid h-11 w-11 place-items-center text-slate-300 disabled:opacity-40" aria-label="One day more" onClick={() => setDays((d) => Math.min(30, d + 1))} disabled={days >= 30}>
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {DAY_CHIPS.map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-full px-3 py-1.5 text-sm ring-1 transition ${d === days ? 'bg-emerald-500/20 text-emerald-200 ring-emerald-500/50' : 'text-slate-300 ring-slate-700 hover:bg-slate-800'}`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <button className="btn btn-primary min-h-11 flex-1 justify-center sm:flex-none" onClick={check} disabled={!photo || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
            {busy ? 'Counting insects…' : 'Check trap'}
          </button>
          {(photo || result) && !busy && (
            <button className="btn btn-ghost min-h-11" onClick={reset}>
              <RotateCcw className="h-4 w-4" /> Start again
            </button>
          )}
        </div>

        {error && (
          <p role="alert" className="flex gap-2 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200 ring-1 ring-rose-500/30">
            <TriangleAlert className="h-4 w-4 shrink-0" /> {error}
          </p>
        )}
      </section>

      <AnimatePresence>{result && <CheckResult key="result" result={result} />}</AnimatePresence>

      {!result && (
        <section className="card text-sm text-slate-400">
          <div className="mb-2 font-semibold text-slate-200">Tips for a good photo</div>
          <ul className="list-disc space-y-1 pl-5">
            {TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CheckResult({ result }) {
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
      className={`card flex scroll-mt-4 flex-col gap-4 ring-1 ${style?.panel ?? 'ring-slate-700'}`}
      data-testid="check-result"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-slate-400">What to do</span>
        <DecisionBadge decision={d?.decision} borderline={d?.borderline} size="lg" />
      </div>
      {d?.reason && <p className="text-sm leading-relaxed text-slate-200">{d.reason}</p>}

      {(fallback || result.vision?.status === 'simulated') && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-100 ring-1 ring-amber-500/30">
          <Badge tone="warn">Simulated data</Badge>
          <Badge tone="warn">Demo detector</Badge>
          {fallback?.message ?? 'These counts come from the demo detector.'}
        </div>
      )}

      {result.counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Whiteflies (pests)" value={counts.whitefly ?? result.totals?.pests ?? 0} />
          <Stat label="Predators" value={result.totals?.predators ?? 0} sub={`MR ${counts.macrolophus ?? 0} · NC ${counts.nesidiocoris ?? 0}`} />
          <Stat label="Pests per day" value={result.per_day?.pests ?? '—'} sub={lo !== undefined ? `range ${lo}-${hi}` : `over ${result.days_hung} days`} />
          <Stat label="Pests per predator" value={d?.no_predators ? 'no predators' : d?.pests_per_predator ?? '—'} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-xs">
        {q && (q.ok ? <Badge tone="good">Photo quality OK</Badge> : <Badge tone="bad">Photo: {q.issues.map((i) => ISSUE_LABELS[i] ?? i).join(', ')} - retake</Badge>)}
        {result.vision?.status === 'ok' && (
          <Badge tone="good">
            <Bug className="h-3 w-3" /> {result.vision.boxes} detections · {result.vision.model}
            {result.vision.image?.grid ? ` · ${result.vision.image.grid} tiles` : ''}
          </Badge>
        )}
        {d?.thresholds && (
          <Badge tone="muted" title="Placeholder thresholds, to confirm with the ICAR-IIHR mentor">
            Action level {d.thresholds.action_threshold_per_day}/day · ratio {d.thresholds.spray_ratio} (placeholder)
          </Badge>
        )}
      </div>

      {adv?.recommendation && (
        <div className="rounded-xl bg-slate-900/60 p-3 ring-1 ring-slate-800">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5" /> Advice{' '}
            <span className="font-normal normal-case tracking-normal text-slate-500">
              ({adv.source === 'gemini' ? 'Gemini' : adv.source === 'claude' ? 'Claude' : 'rule engine'})
            </span>
          </div>
          <ol className="ml-5 list-decimal space-y-1 text-sm text-slate-200">
            {(adv.mitigation_strategy?.length ? adv.mitigation_strategy : [adv.recommendation]).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Decision support only: automated counts, not a verified diagnosis. Scout the crop before treating and follow the
        product label. This check was not saved.
      </p>
    </motion.section>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl bg-slate-900/60 p-3 ring-1 ring-slate-800">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-xl font-bold tabular-nums text-white">{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}
