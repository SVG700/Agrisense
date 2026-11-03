import { useEffect, useMemo, useRef, useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { api } from '../api.js';
import { DECISION_STYLES } from '../lib/decision.js';
import DecisionBadge from './DecisionBadge.jsx';

const MAX_PESTS = 150;
const MAX_PRED = 30;
const STEPS = 50;
const round1 = (n) => Math.round(n * 10) / 10;

/** Quick "what if" moves, applied to the current slider values. */
const SCENARIOS = [
  { id: 'release', label: 'Release predators (+5/day)', apply: (s) => ({ ...s, predators: Math.min(MAX_PRED, s.predators + 5) }) },
  { id: 'double', label: 'Pests double', apply: (s) => ({ ...s, pests: Math.min(MAX_PESTS, s.pests * 2) }) },
  { id: 'spray', label: 'After a spray (-80% pests, -60% predators)', apply: (s) => ({ ...s, pests: round1(s.pests * 0.2), predators: round1(s.predators * 0.4) }) },
  { id: 'blurry', label: 'Low detector confidence', apply: (s) => ({ ...s, confidence: 0.6 }) },
];

/**
 * What-if simulator: move pests/day, predators/day and detector confidence and
 * see the advice change live. Every answer comes from the backend's decision
 * engine (GET /api/decision/simulate), the same function that decides for real
 * traps - nothing is re-implemented here.
 */
export default function WhatIfCard({ deviceId }) {
  const [base, setBase] = useState(null); // this trap's current averages
  const [s, setS] = useState({ pests: 30, predators: 2, confidence: 0.85 });
  const [result, setResult] = useState(null);
  const [regions, setRegions] = useState(null);
  const [error, setError] = useState(null);
  const seq = useRef(0);

  useEffect(() => {
    // Only draw a well-formed grid: a bad response must never take the dashboard down
    const valid = (r) => Array.isArray(r?.pests) && Array.isArray(r?.predators) && Array.isArray(r?.cells) && r.pests.length > 1 && r.thresholds;
    api
      .decisionRegions(MAX_PESTS, MAX_PRED, STEPS)
      .then((r) => setRegions(valid(r) ? r : false))
      .catch(() => setRegions(false));
  }, []);

  // Start from the selected trap's real 3-day averages when it has them
  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    api
      .decision(deviceId)
      .then((d) => {
        if (cancelled || d.avg_pests == null) return;
        const start = {
          pests: Math.min(MAX_PESTS, d.avg_pests),
          predators: Math.min(MAX_PRED, d.avg_predators ?? 0),
          confidence: d.range?.mean_confidence ?? 0.85,
        };
        setBase(start);
        setS(start);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [deviceId]);

  // Ask the engine (debounced; only the newest answer is shown)
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api
        .simulate(s)
        .then((r) => mine === seq.current && (setResult(r), setError(null)))
        .catch((err) => mine === seq.current && setError(err.message));
    }, 150);
    return () => clearTimeout(t);
  }, [s]);

  const set = (k) => (e) => setS((x) => ({ ...x, [k]: Number(e.target.value) }));

  return (
    <section className="card flex flex-col gap-5" data-testid="what-if">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <FlaskConical className="h-4 w-4" />
            </span>
            What if…?
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Change the numbers and see how the advice changes. The answers come from the same decision engine that decides for
            the traps.
          </p>
        </div>
        {base && (
          <button className="btn btn-ghost text-xs" onClick={() => setS(base)}>
            <RotateCcw className="h-3.5 w-3.5" /> Back to this trap
          </button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Slider label="Pests per day (3-day average)" value={s.pests} max={MAX_PESTS} step={0.5} onChange={set('pests')} suffix="/day" />
          <Slider label="Predators per day (MR + NC)" value={s.predators} max={MAX_PRED} step={0.5} onChange={set('predators')} suffix="/day" />
          <Slider
            label="Detector confidence"
            value={s.confidence}
            min={0.5}
            max={0.99}
            step={0.01}
            onChange={set('confidence')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <div className="flex flex-wrap gap-2">
            {SCENARIOS.map((sc) => (
              <button
                key={sc.id}
                onClick={() => setS((x) => sc.apply(x))}
                className="rounded-full px-3 py-1.5 text-xs text-slate-300 ring-1 ring-slate-700 transition hover:bg-slate-800"
              >
                {sc.label}
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-slate-900/60 p-3 ring-1 ring-slate-800" aria-live="polite" data-testid="what-if-result">
            {error ? (
              <p className="text-sm text-rose-300">{error}</p>
            ) : result ? (
              <>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase tracking-widest text-slate-400">Then the advice is</span>
                  <DecisionBadge decision={result.decision} borderline={result.borderline} />
                </div>
                <p className="text-sm text-slate-300">{result.reason}</p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {result.no_predators ? 'No predators' : `${result.pests_per_predator} pests per predator`} · count range{' '}
                  {result.range?.pests?.[0]}-{result.range?.pests?.[1]} pests/day (±{Math.round((result.range?.uncertainty ?? 0) * 100)}%) ·
                  thresholds are placeholders
                </p>
              </>
            ) : (
              <div className="h-10 animate-pulse rounded bg-slate-800/60" />
            )}
          </div>
        </div>

        <DecisionMap regions={regions} point={s} base={base} />
      </div>
    </section>
  );
}

function Slider({ label, value, min = 0, max, step, onChange, suffix = '', format }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="flex justify-between text-slate-300">
        {label}
        <b className="tabular-nums text-white">{format ? format(value) : `${round1(value)}${suffix}`}</b>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={onChange} className="accent-emerald-400" aria-label={label} />
    </label>
  );
}

/** pests/day (x) x predators/day (y) coloured by the engine's decision; the dot is the current what-if. */
function DecisionMap({ regions, point, base }) {
  const W = 320;
  const H = 220;
  const pad = { l: 34, b: 26, t: 8, r: 8 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  // Merge runs of equal cells per row into one rect (51x51 grid -> a few dozen shapes)
  const rects = useMemo(() => {
    if (!regions) return [];
    const nx = regions.pests.length;
    const ny = regions.predators.length;
    const cw = iw / nx;
    const ch = ih / ny;
    const out = [];
    regions.cells.forEach((row, yi) => {
      let start = 0;
      for (let xi = 1; xi <= nx; xi++) {
        if (xi === nx || row[xi] !== row[start]) {
          out.push({ x: pad.l + start * cw, y: pad.t + ih - (yi + 1) * ch, w: (xi - start) * cw + 0.5, h: ch + 0.5, d: row[start] });
          start = xi;
        }
      }
    });
    return out;
  }, [regions, iw, ih, pad.l, pad.t]);

  if (regions === false) return <p className="self-center text-xs text-slate-500">The decision map is unavailable right now.</p>;
  if (!regions) return <div className="h-56 animate-pulse rounded-xl bg-slate-800/50" />;
  const maxP = regions.pests.at(-1);
  const maxR = regions.predators.at(-1);
  const sx = (p) => pad.l + (Math.min(p, maxP) / maxP) * iw;
  const sy = (r) => pad.t + ih - (Math.min(r, maxR) / maxR) * ih;
  const t = regions.thresholds;

  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Decision map: pests per day against predators per day" data-testid="decision-map">
        {rects.map((r, i) => (
          <rect key={i} x={r.x} y={r.y} width={r.w} height={r.h + 0.6} fill={DECISION_STYLES[r.d]?.color} fillOpacity="0.28" shapeRendering="crispEdges" />
        ))}
        {/* action threshold and spray-ratio line */}
        <line x1={sx(t.action_threshold_per_day)} x2={sx(t.action_threshold_per_day)} y1={pad.t} y2={pad.t + ih} stroke="#e2e8f0" strokeDasharray="3 3" opacity="0.6" />
        <line x1={sx(t.action_threshold_per_day)} y1={sy(t.action_threshold_per_day / t.spray_ratio)} x2={sx(maxP)} y2={sy(maxP / t.spray_ratio)} stroke="#e2e8f0" strokeDasharray="3 3" opacity="0.6" />
        {/* axes */}
        <line x1={pad.l} y1={pad.t + ih} x2={pad.l + iw} y2={pad.t + ih} stroke="#64748b" />
        <line x1={pad.l} y1={pad.t} x2={pad.l} y2={pad.t + ih} stroke="#64748b" />
        {[0, 50, 100, 150].filter((v) => v <= maxP).map((v) => (
          <text key={v} x={sx(v)} y={H - 10} fontSize="9" fill="#94a3b8" textAnchor="middle">
            {v}
          </text>
        ))}
        {[0, 10, 20, 30].filter((v) => v <= maxR).map((v) => (
          <text key={v} x={pad.l - 5} y={sy(v) + 3} fontSize="9" fill="#94a3b8" textAnchor="end">
            {v}
          </text>
        ))}
        <text x={pad.l + iw / 2} y={H - 1} fontSize="9" fill="#cbd5e1" textAnchor="middle">
          pests per day →
        </text>
        <text x={10} y={pad.t + ih / 2} fontSize="9" fill="#cbd5e1" textAnchor="middle" transform={`rotate(-90 10 ${pad.t + ih / 2})`}>
          predators per day →
        </text>
        {base && <circle cx={sx(base.pests)} cy={sy(base.predators)} r="5" fill="none" stroke="#e2e8f0" strokeWidth="1.5" />}
        <circle cx={sx(point.pests)} cy={sy(point.predators)} r="5.5" fill="#fff" stroke="#0f172a" strokeWidth="2" data-testid="what-if-point" />
      </svg>
      <figcaption className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
        {['SPRAY', 'BIOCONTROL', 'WAIT'].map((d) => (
          <span key={d} className="inline-flex items-center gap-1">
            <span style={{ color: DECISION_STYLES[d].color }}>{DECISION_STYLES[d].shape}</span>
            {DECISION_STYLES[d].label}
          </span>
        ))}
        <span>● white dot = what-if{base ? ' · ○ ring = this trap now' : ''}</span>
      </figcaption>
    </figure>
  );
}
