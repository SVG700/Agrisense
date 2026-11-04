import { useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ArrowUpRight, Pause, Play, TrendingDown, TrendingUp } from 'lucide-react';
import { AnimatedNumber } from '../lib/motion.jsx';
import { hasCounts, pestMeta, timeAgo, totalOf } from '../lib/pests.js';
import { haptic } from '../lib/theme.js';
import { useT } from '../lib/i18n.jsx';

const SPRING = { type: 'spring', stiffness: 300, damping: 30, mass: 0.8 };

/** Pointer-following light source + gentle press, shared by the three cards. */
function useGlow() {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const onPointerMove = (e) => {
    if (reduce || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    ref.current.style.setProperty('--gx', `${((e.clientX - r.left) / r.width) * 100}%`);
    ref.current.style.setProperty('--gy', `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  const onPointerLeave = () => {
    ref.current?.style.removeProperty('--gx');
    ref.current?.style.removeProperty('--gy');
  };
  return { ref, onPointerMove, onPointerLeave };
}

/**
 * The three feature cards under the day strip: insects trapped (spotlight),
 * the trap photo (image card) and pest pressure (glowing bars).
 */
export default function GlowCards({ capture, telemetry, delta, decision, live, onToggleLive, onViewTrap }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1.6fr]">
      <InsectsCard capture={capture} delta={delta} live={live} onToggleLive={onToggleLive} />
      <PhotoCard capture={capture} onViewTrap={onViewTrap} />
      <PressureCard telemetry={telemetry} decision={decision} className="md:col-span-2 xl:col-span-1" />
    </div>
  );
}

function InsectsCard({ capture, delta, live, onToggleLive }) {
  const t = useT();
  const glow = useGlow();
  const det = capture?.detection;
  const known = hasCounts(det);
  const total = known ? totalOf(det.pest_counts) : null;
  return (
    <motion.article
      {...glow}
      whileTap={{ scale: 0.985 }}
      transition={SPRING}
      className="glow-card flex min-h-[176px] flex-col justify-between p-5"
      aria-label={t('glow.insects')}
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-medium text-[#fff]/90">{t('glow.insects')}</h3>
        <button
          type="button"
          onClick={() => {
            haptic();
            onToggleLive?.();
          }}
          className="grid h-11 w-11 place-items-center rounded-full bg-[#fff] text-[#0c0c0f] shadow-lg transition-transform active:scale-90"
          aria-label={live ? t('glow.pause') : t('glow.resume')}
          aria-pressed={!live}
          title={live ? t('glow.pause') : t('glow.resume')}
        >
          {live ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <div>
        <div className="text-5xl font-semibold tracking-tight tabular-nums">{total === null ? '—' : <AnimatedNumber value={total} />}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-[#fff]/65">
          {delta !== null && delta !== undefined ? (
            <span className="inline-flex items-center gap-1">
              {delta > 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
              {delta > 0 ? '+' : ''}
              {delta} vs previous
            </span>
          ) : (
            <span>{t('glow.latest')}</span>
          )}
          {!live && <span className="rounded-full bg-[#fff]/15 px-2 py-0.5 font-medium text-[#fff]">{t('glow.paused')}</span>}
        </div>
      </div>
    </motion.article>
  );
}

function PhotoCard({ capture, onViewTrap }) {
  const t = useT();
  const glow = useGlow();
  const det = capture?.detection;
  const boxes = det?.bounding_boxes ?? [];
  const conf = boxes.length ? Math.round((boxes.reduce((a, b) => a + (b.confidence ?? 0), 0) / boxes.length) * 100) : null;
  const url = capture?.image_url ?? null;
  return (
    <motion.button
      type="button"
      {...glow}
      onClick={onViewTrap}
      whileTap={{ scale: 0.985 }}
      transition={SPRING}
      className="glow-card photo group flex min-h-[176px] flex-col justify-between p-5 text-left"
      aria-label={t('glow.photoAria')}
    >
      {url && (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 -z-10 h-full w-full object-cover transition-transform duration-700 ease-[var(--spring)] group-hover:scale-105"
        />
      )}
      {/* warm wash like the reference's golden portrait card */}
      <span aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-tr from-[#7c2d12]/85 via-[#c2410c]/45 to-[#f5b544]/20" />
      <div className="flex items-start justify-between">
        <h3 className="text-[15px] font-medium text-[#fff]/95">{t('glow.photo')}</h3>
        <ArrowUpRight className="h-5 w-5 text-[#fff]/80 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-5xl font-semibold tracking-tight tabular-nums">{conf === null ? '—' : `${conf}%`}</div>
          <div className="mt-1 text-xs text-[#fff]/75">{t('glow.confidence')}</div>
        </div>
        <span className="text-xs text-[#fff]/80">{capture ? timeAgo(capture.timestamp) : t('status.never')}</span>
      </div>
    </motion.button>
  );
}

/** Daily pests (tall bar) with predators inside it (gold), against the action level. */
function PressureCard({ telemetry, decision, className = '' }) {
  const t = useT();
  const glow = useGlow();
  const reduce = useReducedMotion();
  const [active, setActive] = useState(null);

  const days = useMemo(() => {
    const byDay = new Map();
    for (const row of telemetry) {
      if (!hasCounts(row.detection)) continue;
      let pests = 0;
      let predators = 0;
      for (const [label, n] of Object.entries(row.detection.pest_counts ?? {})) {
        if (pestMeta(label).predator) predators += Number(n) || 0;
        else pests += Number(n) || 0;
      }
      const day = row.timestamp.slice(0, 10);
      const prev = byDay.get(day);
      if (!prev || pests > prev.pests) byDay.set(day, { day, pests, predators });
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).slice(-10);
  }, [telemetry]);

  const threshold = decision?.thresholds?.action_threshold_per_day ?? 25;
  const max = Math.max(threshold * 1.25, ...days.map((d) => d.pests), 1);
  const peak = days.reduce((m, d) => (!m || d.pests > m.pests ? d : m), null);
  const shown = active ?? peak;
  const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <motion.article {...glow} transition={SPRING} className={`glow-card green flex min-h-[176px] flex-col p-5 ${className}`} aria-labelledby="pressure-title">
      <div className="flex items-start justify-between gap-3">
        <h3 id="pressure-title" className="text-[17px] font-medium text-[#fff]/95">
          {t('glow.pressure')}
        </h3>
        {decision?.avg_pests !== undefined && (
          <span className="rounded-full bg-[#fff]/10 px-3 py-1 text-xs text-[#fff]/85 ring-1 ring-[#fff]/15">
            {t('glow.avg')}: <b className="text-[#fff]">{decision.avg_pests}</b>
          </span>
        )}
      </div>

      {days.length === 0 ? (
        <p className="mt-auto text-sm text-[#fff]/65">{t('glow.noDays')}</p>
      ) : (
        <div className="relative mt-4 flex-1">
          {/* action level */}
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-[#fff]/50"
            style={{ bottom: `${(threshold / max) * 100}%` }}
            aria-hidden="true"
          >
            <span className="absolute -top-2.5 right-0 rounded bg-black/40 px-1 text-[10px] text-[#fff]/80">
              {t('glow.actionLevel', { n: threshold })}
            </span>
          </div>
          {shown && (
            <span className="absolute left-0 top-0 z-10 rounded-full bg-[#fff] px-2.5 py-1 text-[11px] font-semibold text-[#0c0c0f] shadow-lg" aria-live="polite">
              {active ? fmtDay(shown.day) : t('glow.peak')}: {shown.pests}
            </span>
          )}
          <ul className="flex h-28 items-end justify-around gap-2" aria-label={t('glow.pressureAria')}>
            {days.map((d, i) => {
              const h = (d.pests / max) * 100;
              const ph = d.pests ? Math.min(100, (d.predators / d.pests) * 100) : 0;
              const over = d.pests >= threshold;
              return (
                <li key={d.day} className="flex h-full max-w-16 flex-1 items-end">
                  <button
                    type="button"
                    className="relative flex h-full w-full items-end rounded-xl outline-offset-2"
                    onPointerEnter={() => setActive(d)}
                    onPointerLeave={() => setActive(null)}
                    onFocus={() => setActive(d)}
                    onBlur={() => setActive(null)}
                    aria-label={`${fmtDay(d.day)}: ${d.pests} pests, ${d.predators} predators${over ? ', above the action level' : ''}`}
                  >
                    <motion.span
                      className={`relative block w-full overflow-hidden rounded-xl ${over ? 'bg-[#fff]/30' : 'bg-[#fff]/15'}`}
                      initial={reduce ? false : { height: 0 }}
                      animate={{ height: `${Math.max(4, h)}%` }}
                      transition={{ ...SPRING, delay: reduce ? 0 : i * 0.04 }}
                    >
                      <span
                        className={`absolute inset-x-0 bottom-0 block rounded-xl bg-gradient-to-t from-[#d97706] to-[#f5b544] ${d.predators ? 'bar-glow' : ''}`}
                        style={{ height: `${ph}%` }}
                      />
                    </motion.span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-2 flex justify-between text-[10px] text-[#fff]/55" aria-hidden="true">
            <span>{fmtDay(days[0].day)}</span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-sm bg-[#f5b544]" /> {t('glow.predators')}
            </span>
            <span>{fmtDay(days.at(-1).day)}</span>
          </div>
        </div>
      )}
    </motion.article>
  );
}

