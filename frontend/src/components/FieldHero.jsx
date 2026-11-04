import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowUpRight,
  BatteryMedium,
  Bug,
  Camera,
  ChevronLeft,
  ChevronRight,
  Droplets,
  Leaf,
  Lightbulb,
  Mic,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Thermometer,
  TriangleAlert,
  X,
} from 'lucide-react';
import { api } from '../api.js';
import { decisionStyle } from '../lib/decision.js';
import { hasCounts, pestMeta } from '../lib/pests.js';
import { AnimatedNumber, useLiquid } from '../lib/motion.jsx';
import LocationPicker from './LocationPicker.jsx';
import { haptic } from '../lib/theme.js';
import { decisionReason, useT } from '../lib/i18n.jsx';

const SPRING = { type: 'spring', stiffness: 260, damping: 30, mass: 0.9 };
export const VISION_LAYOUT_ID = 'trap-vision';

/* ========================================================================== */
/*  Left half: trap rail, title, scanner, Live Vision                          */
/* ========================================================================== */

export function TrapStage({ device, devices, capture, decision, index, count, onStep, onSelectDevice, onAddTrap, onOpenVision, visionOpen }) {
  const t = useT();
  const reduce = useReducedMotion();
  const boxes = (capture?.detection?.bounding_boxes ?? []).slice(0, 60);
  const confs = boxes.map((b) => b.confidence ?? 0);
  const mean = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null;
  const sd = confs.length > 1 ? Math.sqrt(confs.reduce((a, c) => a + (c - mean) ** 2, 0) / (confs.length - 1)) : null;
  const [lo, hi] = decision?.range?.pests ?? [];
  const spread = lo !== undefined && hi !== undefined ? (hi - lo) / 2 : null;
  const canPrev = index > 0;
  const canNext = index < count - 1;
  const step = (dir) => {
    if ((dir < 0 && !canPrev) || (dir > 0 && !canNext)) return;
    haptic();
    onStep(dir);
  };
  const liquid = useLiquid(0.12);

  return (
    <section className="relative flex min-h-[560px] min-w-0 flex-col items-center overflow-x-clip px-2 pb-6 pt-4 lg:min-h-[640px] lg:overflow-visible" aria-labelledby="stage-title">
      <motion.h1
        id="stage-title"
        key={device?.id}
        initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={SPRING}
        className="max-w-[16ch] text-center text-4xl font-medium leading-[1.05] tracking-tight text-ink sm:text-5xl lg:text-[3.4rem]"
      >
        {device?.name ?? t('hero.waiting')}
      </motion.h1>

      {/* capture stepper (arrows, ← → keys, or swipe) */}
      <motion.div
        role="group"
        aria-label={t('day.stripAria')}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') step(-1);
          if (e.key === 'ArrowRight') step(1);
        }}
        drag={reduce ? false : 'x'}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.2}
        dragSnapToOrigin
        onDragEnd={(_, info) => (info.offset.x <= -48 ? step(1) : info.offset.x >= 48 ? step(-1) : null)}
        className="mt-4 flex touch-pan-y items-center gap-2 rounded-full bg-surface/70 p-1 text-sm text-slate-600 shadow-[var(--elev-1)] ring-1 ring-line backdrop-blur"
      >
        <StepButton label={t('day.prev')} disabled={!canPrev} onClick={() => step(-1)}>
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </StepButton>
        <span className="px-1 tabular-nums">
          {t('day.capture')} <b className="text-ink">{count ? index + 1 : 0}</b> / {count}
          {capture && <span className="ml-1.5 text-slate-500">· {new Date(capture.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
        </span>
        <StepButton label={t('day.next')} disabled={!canNext} onClick={() => step(1)}>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </StepButton>
      </motion.div>

      {/* trap rail */}
      <TrapRail devices={devices} activeId={device?.id} onSelect={onSelectDevice} onAdd={onAddTrap} />

      {/* scanner */}
      <div className="relative mt-6 grid w-full flex-1 place-items-center">
        <div className="scan-ring relative aspect-square w-[min(78vw,330px)]">
          <motion.span
            aria-hidden="true"
            className="absolute inset-[-22px] rounded-full border border-[#fff]/50"
            animate={reduce ? undefined : { scale: [1, 1.04, 1], opacity: [0.6, 0.2, 0.6] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
          />
        </div>

        <motion.button
          type="button"
          layoutId={visionOpen ? undefined : VISION_LAYOUT_ID}
          onClick={(e) => onOpenVision({ x: e.clientX, y: e.clientY })}
          whileHover={reduce ? undefined : { rotate: -4, scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          transition={SPRING}
          className="absolute aspect-[4/5] w-[min(52vw,230px)] -rotate-[8deg] overflow-hidden rounded-[30px_30px_30px_80px] bg-[#f3c94a] shadow-[0_40px_60px_-28px_rgb(80_60_10/0.65)] outline-offset-4"
          aria-label={t('vision.open')}
        >
          {capture?.image_url && <img src={capture.image_url} alt="" className="absolute inset-0 h-full w-full object-cover" />}
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {boxes.map((b, i) => (
              <circle key={i} cx={b.x + b.width / 2} cy={b.y + b.height / 2} r="0.012" fill={pestMeta(b.label).color} stroke="#fff" strokeWidth="0.004" />
            ))}
          </svg>
          <span className="scan-sweep" aria-hidden="true" />
        </motion.button>

        {/* callouts with connector lines */}
        <Callout
          side="left"
          label={t('vision.confidence')}
          value={mean !== null ? mean.toFixed(3) : '—'}
          plusMinus={sd !== null ? sd.toFixed(2) : null}
          className="left-[2%] top-[74%] sm:left-[4%] lg:left-[15%]"
        />
        <Callout
          side="right"
          label={t('vision.pestsDay')}
          value={decision?.avg_pests !== undefined ? Number(decision.avg_pests).toFixed(1) : '—'}
          plusMinus={spread !== null ? spread.toFixed(1) : null}
          className="right-[2%] top-[38%] sm:right-[4%]"
        />
      </div>

      {/* Live Vision (reference: "Scanning…") */}
      <motion.button
        type="button"
        {...liquid}
        onClick={(e) => (haptic(), onOpenVision({ x: e.clientX, y: e.clientY }))}
        whileTap={{ scale: 0.96 }}
        className={`${liquid.className} relative mt-6 inline-flex min-h-14 flex-col items-center justify-center rounded-xl px-9 text-ink [--liquid:var(--color-butter)]`}
        aria-describedby="vision-hint"
      >
        <span className="bracket left-0 top-0 rounded-tl-md border-l-2 border-t-2 text-ink/70" aria-hidden="true" />
        <span className="bracket right-0 top-0 rounded-tr-md border-r-2 border-t-2 text-ink/70" aria-hidden="true" />
        <span className="bracket bottom-0 left-0 rounded-bl-md border-b-2 border-l-2 text-ink/70" aria-hidden="true" />
        <span className="bracket bottom-0 right-0 rounded-br-md border-b-2 border-r-2 text-ink/70" aria-hidden="true" />
        <span className="text-lg font-medium tracking-tight">{t('vision.title')}</span>
        <span id="vision-hint" className="text-[11px] text-slate-500">
          {t('vision.hint')}
        </span>
      </motion.button>
    </section>
  );
}

function StepButton({ label, disabled, onClick, children }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.88 }}
      transition={SPRING}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="grid h-10 w-10 place-items-center rounded-full text-ink transition-colors hover:bg-slate-100 disabled:opacity-30"
    >
      {children}
    </motion.button>
  );
}

function Callout({ side, label, value, plusMinus, className }) {
  const left = side === 'left';
  return (
    <motion.div
      initial={{ opacity: 0, x: left ? -14 : 14 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ ...SPRING, delay: 0.25 }}
      className={`pointer-events-none absolute hidden sm:block ${className}`}
    >
      <div className={`flex items-end gap-0 ${left ? '' : 'flex-row-reverse'}`}>
        <div className={left ? '' : 'text-right'}>
          <div className="text-xs text-slate-600">{label}</div>
          <div className="text-xl font-medium tracking-tight text-ink tabular-nums">
            {value}
            {plusMinus && <span className="text-slate-600"> ± {plusMinus}</span>}
          </div>
        </div>
        <svg width="90" height="44" viewBox="0 0 90 44" className={`mb-5 ${left ? '' : 'scale-x-[-1]'}`} aria-hidden="true">
          <path d="M2 42 H48 L82 8" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-[#fff] [:root[data-theme=dark]_&]:text-[#fff]/40" />
          <circle cx="82" cy="8" r="5" fill="#fff" stroke="rgb(246 216 103)" strokeWidth="2" />
        </svg>
      </div>
    </motion.div>
  );
}

/** Reference's plant thumbnails: one tile per trap + Add. */
function TrapRail({ devices, activeId, onSelect, onAdd }) {
  const t = useT();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    try {
      await onAdd(name.trim());
      setAdding(false);
      setName('');
      setErr(null);
    } catch (ex) {
      setErr(ex.status === 401 || ex.status === 403 ? t('rail.needKey') : ex.message);
    }
  };
  return (
    <nav
      aria-label={t('rail.aria')}
      className="z-10 mt-5 flex max-w-full gap-3 overflow-x-auto p-1 lg:absolute lg:left-0 lg:top-1/2 lg:mt-0 lg:-translate-y-1/2 lg:flex-col lg:overflow-visible"
    >
      {devices.map((d) => {
        const active = d.id === activeId;
        return (
          <motion.button
            key={d.id}
            type="button"
            onClick={() => (haptic(), onSelect(d.id))}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.94 }}
            transition={SPRING}
            aria-current={active ? 'true' : undefined}
            title={d.name}
            className={`relative grid h-[68px] w-[68px] shrink-0 place-items-center rounded-2xl bg-surface shadow-[var(--elev-2)] transition-[box-shadow] ${
              active ? 'ring-2 ring-butter' : 'ring-1 ring-line'
            }`}
          >
            {active && <motion.span layoutId="rail-active" className="absolute inset-1 rounded-xl bg-butter-soft" transition={SPRING} />}
            <span className="relative grid h-10 w-8 -rotate-6 place-items-center rounded-md bg-[#f3c94a] shadow-inner" aria-hidden="true">
              <Bug className="h-4 w-4 text-[#5b4410]" />
            </span>
            <span className="sr-only">{d.name}</span>
            <span className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full ring-2 ring-surface" style={{ background: d.battery_level < 15 ? '#e11d48' : '#22c55e' }} aria-hidden="true" />
          </motion.button>
        );
      })}

      <div className="relative">
        <motion.button
          type="button"
          onClick={() => setAdding((a) => !a)}
          whileTap={{ scale: 0.94 }}
          className="grid h-[68px] w-[68px] shrink-0 place-items-center rounded-2xl bg-cocoa/70 text-[11px] font-medium text-[#fff] shadow-[var(--elev-2)] [:root[data-theme=dark]_&]:text-[#2b231c]"
          aria-expanded={adding}
        >
          <span className="flex flex-col items-center gap-0.5">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('rail.add')}
          </span>
        </motion.button>
        <AnimatePresence>
          {adding && (
            <motion.form
              onSubmit={submit}
              initial={{ opacity: 0, scale: 0.92, x: -6 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={SPRING}
              className="absolute left-0 top-[76px] z-20 w-60 origin-top-left rounded-2xl bg-surface p-3 shadow-[var(--elev-4)] ring-1 ring-line lg:left-[80px] lg:top-0"
            >
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                {t('rail.name')}
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className="field px-3 py-2 text-sm font-normal" placeholder="Polyhouse 4" />
              </label>
              {err && <p className="mt-2 text-xs text-rose-700">{err}</p>}
              <div className="mt-2 flex gap-2">
                <button type="submit" className="btn btn-primary min-h-9 flex-1 py-1.5 text-xs">
                  {t('rail.create')}
                </button>
                <button type="button" onClick={() => setAdding(false)} className="btn btn-ghost min-h-9 px-3 py-1.5 text-xs" aria-label={t('spray.cancel')}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>
      </div>
    </nav>
  );
}

/* ========================================================================== */
/*  Right half: the reference's card grid                                     */
/* ========================================================================== */

export function HeroCards({ device, capture, telemetry, decision, events, onSeeAll, onSelectCapture, weather }) {
  return (
    <div className="grid gap-4 sm:grid-cols-[1.75fr_1fr]">
      <TrapHealthCard device={device} capture={capture} weather={weather} onSeeAll={() => onSeeAll('glance')} />
      <PressureCard telemetry={telemetry} decision={decision} />
      <ListenCard capture={capture} decision={decision} />
      <GuideCard />
      <RecentUpdates events={events} onSeeAll={() => onSeeAll('timeline')} onSelectCapture={onSelectCapture} className="sm:col-span-2" />
    </div>
  );
}

function Card({ className = '', children, ...rest }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={SPRING}
      whileHover={{ y: -3 }}
      className={`silver relative rounded-[26px] bg-surface/95 p-5 shadow-[var(--elev-2)] ring-1 ring-line transition-shadow duration-500 hover:shadow-[var(--elev-3)] ${className}`}
      {...rest}
    >
      {children}
    </motion.section>
  );
}

function SeeAll({ onClick, children }) {
  return (
    <button type="button" onClick={onClick} className="shrink-0 whitespace-nowrap text-sm text-ink underline decoration-1 underline-offset-4 transition-colors hover:text-slate-600">
      {children}
    </button>
  );
}

function TrapHealthCard({ device, capture, weather, onSeeAll }) {
  const t = useT();
  const [light, setLight] = useState(null);
  useEffect(() => {
    let off = false;
    if (device?.id)
      api
        .controls(device.id)
        .then((c) => !off && setLight(c?.switches?.trap_light?.on ?? null))
        .catch(() => !off && setLight(null));
    return () => {
      off = true;
    };
  }, [device?.id]);
  // Humidity and temperature are the live outdoor values at the chosen place; the trap's own sensor reading is shown under them
  const w = weather?.data?.available ? weather.data : null;
  const trapRh = capture?.humidity != null ? `${t('place.trap')} ${Math.round(capture.humidity)}%` : null;
  const trapT = capture?.temperature != null ? `${t('place.trap')} ${Math.round(capture.temperature)}°C` : null;
  const tiles = [
    { icon: BatteryMedium, label: t('status.battery'), value: device ? `${device.battery_level}%` : '—' },
    { icon: Droplets, label: t('kpi.humidity'), value: w ? <AnimatedNumber value={w.humidity} suffix="%" /> : '—', sub: trapRh, live: Boolean(w) },
    { icon: Thermometer, label: t('kpi.temperature'), value: w ? <AnimatedNumber value={w.temperature} decimals={1} suffix="°C" /> : '—', sub: trapT, live: Boolean(w) },
    { icon: Lightbulb, label: t('card.trapLight'), value: light === null ? '—' : light ? t('card.on') : t('card.off') },
  ];
  const updated = w?.fetched_at ? Math.max(0, Math.round((Date.now() - Date.parse(w.fetched_at)) / 60_000)) : null;
  return (
    <Card aria-labelledby="health-title">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="health-title" className="text-xl font-medium tracking-tight text-ink">
            {t('card.health')}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <LocationPicker label={weather?.data?.location?.label ?? weather?.place?.label} />
            {w && (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500" title={w.time ? `Open-Meteo · ${w.time} ${w.timezone ?? ''}` : undefined}>
                <span className="live-dot text-emerald-500" aria-hidden="true" />
                {updated === 0 ? t('place.justNow') : t('place.minAgo', { n: updated })}
              </span>
            )}
          </div>
        </div>
        <SeeAll onClick={onSeeAll}>{t('card.seeAll')}</SeeAll>
      </div>
      <ul className="grid grid-cols-2 gap-3">
        {tiles.map(({ icon: Icon, label, value, sub, live }) => (
          <li key={label} className="flex items-center gap-3 rounded-2xl p-3 ring-1 ring-line transition-colors hover:bg-slate-50">
            <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-butter-soft text-[#8a6a00] [:root[data-theme=dark]_&]:text-butter">
              <Icon className="h-4 w-4" aria-hidden="true" />
              {live && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-surface" aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <div className="truncate text-xs text-slate-500">{label}</div>
              <div className="truncate text-sm font-medium tabular-nums text-ink">{value}</div>
              {sub && <div className="truncate text-[11px] text-slate-500">{sub}</div>}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Reference "Growth": butter-yellow card, line of pests per day, change pill. */
function PressureCard({ telemetry, decision }) {
  const t = useT();
  const [range, setRange] = useState(7);
  const [hover, setHover] = useState(null);
  const days = useMemo(() => {
    const byDay = new Map();
    for (const row of telemetry) {
      if (!hasCounts(row.detection)) continue;
      let pests = 0;
      for (const [label, n] of Object.entries(row.detection.pest_counts ?? {})) if (!pestMeta(label).predator) pests += Number(n) || 0;
      const day = row.timestamp.slice(0, 10);
      byDay.set(day, Math.max(byDay.get(day) ?? 0, pests));
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-range).map(([day, pests]) => ({ day, pests }));
  }, [telemetry, range]);
  const W = 200;
  const H = 110;
  const max = Math.max(1, ...days.map((d) => d.pests), decision?.thresholds?.action_threshold_per_day ?? 0);
  const pts = days.map((d, i) => [days.length === 1 ? W / 2 : (i / (days.length - 1)) * W, H - 8 - (d.pests / max) * (H - 24)]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = days.at(-1);
  const prev = days.at(-2);
  const change = last && prev && prev.pests ? Math.round(((last.pests - prev.pests) / prev.pests) * 100) : null;
  const focus = hover ?? (pts.length ? pts.length - 1 : null);
  const fmt = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <Card className="flex flex-col bg-gradient-to-br! from-[#fbe9a6] to-[#f3cf55] text-[#2b231c] ring-[#f0c94a]/50 [:root[data-theme=dark]_&]:from-[#3b3112] [:root[data-theme=dark]_&]:to-[#2a220c] [:root[data-theme=dark]_&]:text-[#f4efe8]" aria-labelledby="pressure-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pressure-title" className="text-xl font-medium tracking-tight">
          {t('glow.pressure')}
        </h2>
        <label className="relative text-xs opacity-75">
          <span className="sr-only">{t('card.range')}</span>
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} className="cursor-pointer appearance-none bg-transparent pr-3 outline-none">
            <option value={7}>{t('card.week')}</option>
            <option value={30}>{t('card.month')}</option>
          </select>
          <span className="pointer-events-none absolute right-0 top-0" aria-hidden="true">
            ▾
          </span>
        </label>
      </div>
      {days.length < 2 ? (
        <p className="mt-auto pt-6 text-sm opacity-70">{t('glow.noDays')}</p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 h-auto w-full overflow-visible" role="img" aria-label={t('glow.pressureAria')}>
            <defs>
              <linearGradient id="pc-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
                <stop offset="1" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#pc-fill)" />
            <motion.path d={line} fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1, ease: [0.32, 0.72, 0, 1] }} />
            {pts.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={i === focus ? 3.6 : 9}
                fill={i === focus ? '#2b231c' : 'transparent'}
                stroke={i === focus ? '#fff' : 'none'}
                strokeWidth="1.5"
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            ))}
            {focus !== null && (
              <g transform={`translate(${Math.min(W - 34, Math.max(0, pts[focus][0] - 17))} ${Math.max(0, pts[focus][1] - 26)})`}>
                <rect width="34" height="16" rx="8" fill="#2b231c" />
                <text x="17" y="11" textAnchor="middle" fontSize="8" fill="#fff" fontWeight="600">
                  {hover !== null ? days[hover].pests : change !== null ? `${change > 0 ? '↗' : '↘'}${Math.abs(change)}%` : last.pests}
                </text>
              </g>
            )}
          </svg>
          <div className="mt-1 flex justify-between text-[11px] opacity-75" aria-hidden="true">
            {days.filter((_, i) => i === 0 || i === days.length - 1 || i % Math.ceil(days.length / 5) === 0).map((d) => (
              <span key={d.day}>{fmt(d.day)}</span>
            ))}
          </div>
          {change !== null && <p className="sr-only">{change}% vs the previous day</p>}
        </>
      )}
    </Card>
  );
}

/**
 * Reference "Smart Analysis": the AI advice read aloud in a natural Gemini voice
 * (POST /api/voice). The text is split into sentences: the first plays as soon
 * as it is ready while the rest are generated in parallel and queued, so it
 * starts in seconds. The waveform is drawn from the real audio. If the natural
 * voice is unavailable, the browser's voice is used instead.
 */
const BARS = 56;
const CHUNK_CHARS = 1100; // first sentence + the rest: at most 2 voice calls per advice (TTS quotas are tight)
const voiceParts = new Map(); // `${lang}|${chunk}` -> Promise<{url, duration, peaks}> (shared across remounts)

/** Sentence-sized pieces (whole sentences, at most ~CHUNK_CHARS each). */
export function splitForSpeech(text) {
  const sentences = text.match(/[^.!?।]+[.!?।]+["')\]]*\s*|[^.!?।]+$/g) ?? [text];
  const out = [];
  let cur = '';
  for (const s of sentences) {
    // The first piece is a single sentence, so playback can start as soon as possible
    if (cur && (out.length === 0 || (cur + s).length > CHUNK_CHARS)) {
      out.push(cur.trim());
      cur = '';
    }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Peaks (0-1, unnormalised) and duration from decoded audio. */
async function decode(blob) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return {};
    const ctx = new Ctx();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close?.();
    const data = buf.getChannelData(0);
    const n = Math.max(4, Math.round(buf.duration * 3)); // ~3 bars per second
    const step = Math.floor(data.length / n);
    const peaks = [];
    for (let i = 0; i < n; i++) {
      let m = 0;
      for (let j = i * step; j < (i + 1) * step; j += 32) m = Math.max(m, Math.abs(data[j]));
      peaks.push(m);
    }
    return { peaks, duration: buf.duration };
  } catch {
    return {};
  }
}

function fetchPart(chunk, lang, voiceName) {
  const key = `${voiceName ?? 'default'}|${lang}|${chunk}`;
  if (!voiceParts.has(key)) {
    const p = api.voice(chunk, lang, voiceName).then(async (blob) => ({ url: URL.createObjectURL(blob), ...(await decode(blob)) }));
    p.catch(() => voiceParts.delete(key)); // let a later press retry
    voiceParts.set(key, p);
  }
  return voiceParts.get(key);
}

/** Resample concatenated per-part peaks to exactly `BARS` bars. */
function toBars(parts) {
  const all = parts.flatMap((p) => p?.peaks ?? []);
  if (!all.length) return null;
  const top = Math.max(...all, 0.01);
  return Array.from({ length: BARS }, (_, i) => all[Math.floor((i / BARS) * all.length)] / top);
}

function ListenCard({ capture, decision }) {
  const t = useT();
  const adv = capture?.detection?.ai_advisory;
  const text = useMemo(() => {
    if (!adv) return '';
    const steps = (adv.mitigation_strategy?.length ? adv.mitigation_strategy : [adv.recommendation]).filter(Boolean).slice(0, 3);
    return [decision ? decisionReason(t.lang, decision) : '', adv.summary ?? '', ...steps].filter(Boolean).join(' ').slice(0, 1200);
  }, [adv, decision, t.lang]);
  const chunks = useMemo(() => (text ? splitForSpeech(text) : []), [text]);
  const speechOK = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // idle | loading | playing | paused
  const [state, setState] = useState('idle');
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const [parts, setParts] = useState([]); // resolved parts, by index
  const [mode, setMode] = useState('natural'); // natural | browser
  const [voiceName, setVoiceName] = useState(readVoice);
  const [note, setNote] = useState(null);
  const audio = useRef(null);
  const run = useRef(0); // bumps on stop/restart so stale playback chains end
  const rateRef = useRef(rate);
  rateRef.current = rate;

  const fallbackBars = useMemo(() => {
    let h = 7;
    return Array.from({ length: BARS }, (_, i) => {
      h = (h * 31 + text.charCodeAt(i % Math.max(1, text.length)) + i) % 97;
      return (0.25 + (h % 70) / 100) * (0.45 + 0.55 * Math.sin((i / BARS) * Math.PI));
    });
  }, [text]);
  const realBars = parts.length === chunks.length && chunks.length ? toBars(parts) : null;
  const bars = realBars ?? fallbackBars;

  const stopAll = () => {
    run.current++;
    audio.current?.pause();
    audio.current = null;
    if (speechOK) window.speechSynthesis.cancel();
  };
  useEffect(() => () => stopAll(), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    stopAll();
    setParts([]);
    setState('idle');
    setProgress(0);
    setMode('natural');
    setNote(null);
  }, [text, t.lang, voiceName]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Starts generating every piece (first one first); resolves when the first is ready. */
  const prepare = () => {
    if (!chunks.length) return Promise.reject(new Error('no text'));
    // One after another (not in parallel) to stay inside the per-minute voice quota
    let prev = Promise.resolve();
    const promises = chunks.map((c, i) => {
      const p = prev.then(() => fetchPart(c, t.lang, voiceName));
      prev = p.catch(() => {});
      p.then((part) => setParts((prev) => {
        const next = [...prev];
        next[i] = part;
        return next;
      })).catch(() => {});
      return p;
    });
    return promises[0].then(() => promises);
  };

  const estimate = (i) => (parts[i]?.duration ?? chunks[i].length / 15); // ~15 chars/s before decoding
  const totalSecs = chunks.reduce((a, _, i) => a + estimate(i), 0);

  const speakWithBrowser = (say = text) => {
    if (!speechOK) return setState('idle');
    const u = new SpeechSynthesisUtterance(say);
    u.lang = t.lang === 'kn' ? 'kn-IN' : 'en-IN';
    u.rate = rateRef.current;
    const offset = text.length - say.length;
    u.onboundary = (e) => setProgress(Math.min(1, (offset + e.charIndex) / text.length));
    u.onend = () => (setState('idle'), setProgress(1));
    u.onerror = () => setState('idle');
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setState('playing');
  };

  const playFrom = async (promises, i, token) => {
    if (token !== run.current) return;
    if (i >= promises.length) return (setState('idle'), setProgress(1));
    let part;
    try {
      part = await promises[i];
    } catch (err) {
      // Quota or network trouble mid-way: finish the rest with the browser voice
      setNote(t('card.voiceFallback', { why: err.code ?? 'error' }));
      setMode('browser');
      return speakWithBrowser(chunks.slice(i).join(' '));
    }
    if (token !== run.current) return;
    const done = chunks.slice(0, i).reduce((a, _, k) => a + estimate(k), 0);
    const a = new Audio(part.url);
    a.playbackRate = rateRef.current;
    a.ontimeupdate = () => totalSecs && setProgress(Math.min(1, (done + a.currentTime) / totalSecs));
    a.onended = () => playFrom(promises, i + 1, token);
    audio.current = a;
    await a.play();
    setState('playing');
  };

  const play = async () => {
    if (!text) return;
    haptic();
    if (state === 'playing') {
      if (mode === 'browser') window.speechSynthesis.pause();
      else audio.current?.pause();
      return setState('paused');
    }
    if (state === 'paused') {
      if (mode === 'browser') window.speechSynthesis.resume();
      else await audio.current?.play();
      return setState('playing');
    }
    stopAll();
    const token = run.current;
    setState('loading');
    setProgress(0);
    try {
      const promises = await prepare();
      setMode('natural');
      await playFrom(promises, 0, token);
    } catch (err) {
      if (token !== run.current) return;
      // Natural voice unavailable (no key, quota, offline): fall back to the browser voice
      setMode('browser');
      setNote(t('card.voiceFallback', { why: err.code ?? 'error' }));
      speakWithBrowser();
    }
  };

  const reset = () => {
    stopAll();
    setState('idle');
    setProgress(0);
  };
  const nextRate = () => {
    const r = { 1: 1.25, 1.25: 1.5, 1.5: 2, 2: 1 }[rate];
    setRate(r);
    if (audio.current) audio.current.playbackRate = r;
    if (mode === 'browser' && state !== 'idle') reset();
  };

  const remaining = Math.max(0, Math.round((totalSecs * (state === 'idle' && progress >= 1 ? 1 : 1 - progress)) / rate));
  const mmss = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`;
  const warm = () => prepare().catch(() => {});

  // Quietly prepare just the first sentence once the advice is on screen (one short,
  // cached clip per new advice), so pressing play starts at once
  useEffect(() => {
    if (!chunks.length) return undefined;
    const id = setTimeout(() => fetchPart(chunks[0], t.lang, voiceName).catch(() => {}), 1500);
    return () => clearTimeout(id);
  }, [chunks, t.lang, voiceName]);

  return (
    <Card aria-labelledby="listen-title" className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="listen-title" className="text-xl font-medium tracking-tight text-ink">
            {t('title.advisory')}
          </h2>
          <p className="text-xs text-slate-500">
            {t('card.listen')} · <span className="font-medium text-[#8a6a00] [:root[data-theme=dark]_&]:text-butter">{mode === 'browser' ? t('card.browserVoice') : t('card.naturalVoice')}</span>
          </p>
          <VoicePicker
            value={voiceName}
            lang={t.lang}
            onChange={(v) => {
              setVoiceName(v);
              writeVoice(v);
            }}
          />
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.88 }}
          onClick={play}
          onPointerEnter={warm}
          onFocus={warm}
          disabled={!text}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface text-ink shadow-[var(--elev-2)] ring-1 ring-line disabled:opacity-40"
          aria-label={state === 'playing' ? t('card.pause') : state === 'loading' ? t('card.preparing') : t('card.play')}
          aria-busy={state === 'loading'}
        >
          {state === 'loading' ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
          ) : state === 'playing' ? (
            <Pause className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Play className="h-4 w-4" aria-hidden="true" />
          )}
        </motion.button>
      </div>

      <div className="my-4 flex h-16 items-center gap-[3px]" aria-hidden="true">
        {bars.map((h, i) => {
          const played = i / bars.length < progress;
          return (
            <motion.span
              key={i}
              className={`w-[3px] flex-1 rounded-full ${played ? 'bg-[#c9a227]' : 'bg-[#e8d9a8] [:root[data-theme=dark]_&]:bg-[#5a4c22]'}`}
              initial={false}
              animate={
                state === 'loading'
                  ? { height: `${18 + ((i * 13) % 40)}%`, opacity: [0.35, 1, 0.35] }
                  : { height: `${Math.max(10, h * 100)}%`, opacity: 1, scaleY: state === 'playing' && mode === 'browser' ? [1, 0.7, 1] : 1 }
              }
              transition={
                state === 'loading'
                  ? { opacity: { duration: 1.1, repeat: Infinity, delay: (i % 12) * 0.05 }, height: { type: 'spring', stiffness: 200, damping: 20 } }
                  : { type: 'spring', stiffness: 220, damping: 24, delay: realBars ? i * 0.006 : 0 }
              }
            />
          );
        })}
      </div>

      <div className="mt-auto flex items-center gap-3 text-sm text-slate-600">
        <button type="button" onClick={reset} className="grid h-9 w-9 place-items-center rounded-full hover:bg-slate-100" aria-label={t('card.restart')}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
        <button type="button" onClick={nextRate} className="min-h-9 rounded-full px-2 tabular-nums hover:bg-slate-100" aria-label={`${t('card.speed')} ${rate}x`}>
          {rate}x
        </button>
        <span className="ml-auto font-medium tabular-nums text-ink">{state === 'loading' ? t('card.preparing') : text ? mmss : '—'}</span>
      </div>
      {note && <p className="mt-2 text-[11px] text-slate-500">{note}</p>}
    </Card>
  );
}

const VOICE_KEY = 'agrisense.voice';
function readVoice() {
  try {
    return localStorage.getItem(VOICE_KEY) || null;
  } catch {
    return null;
  }
}
function writeVoice(v) {
  try {
    v ? localStorage.setItem(VOICE_KEY, v) : localStorage.removeItem(VOICE_KEY);
  } catch {
    /* not remembered */
  }
}

/** Choose the Gemini voice; each voice can be previewed with one short line. */
function VoicePicker({ value, lang, onChange }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(null); // {voice: default, voices: [{name, style}]}
  const [previewing, setPreviewing] = useState(null);
  const [err, setErr] = useState(null);
  const player = useRef(null);
  const box = useRef(null);

  useEffect(() => {
    if (!open || list) return;
    api.voices().then(setList).catch(() => setList({ voice: null, voices: [] }));
  }, [open, list]);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => box.current && !box.current.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
      player.current?.pause();
    };
  }, [open]);

  const current = value ?? list?.voice ?? 'Kore';
  const preview = async (name) => {
    haptic();
    player.current?.pause();
    setPreviewing(name);
    setErr(null);
    try {
      const part = await fetchPart(t('card.previewLine'), lang, name);
      const a = new Audio(part.url);
      a.onended = () => setPreviewing(null);
      player.current = a;
      await a.play();
    } catch (e) {
      setPreviewing(null);
      setErr(e.status === 429 ? t('card.voiceBusy') : e.message);
    }
  };

  return (
    <div ref={box} className="relative mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-butter-soft px-2.5 text-xs font-medium text-[#6b5200] transition-colors hover:bg-[#f6e3a1] [:root[data-theme=dark]_&]:text-butter"
      >
        <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        {t('card.voice')}: {current}
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={SPRING}
            className="absolute left-0 top-10 z-30 w-72 origin-top-left overflow-hidden rounded-2xl bg-surface shadow-[var(--elev-4)] ring-1 ring-line"
          >
            <p className="border-b border-line px-4 py-2.5 text-[11px] text-slate-500">{t('card.voiceHelp')}</p>
            <ul role="listbox" aria-label={t('card.voice')} className="max-h-72 overflow-y-auto p-1.5">
              {!list && <li className="px-3 py-3 text-sm text-slate-500">…</li>}
              {list?.voices.map((v) => {
                const selected = v.name === current;
                return (
                  <li key={v.name} className={`flex items-center gap-2 rounded-xl px-2 py-1 ${selected ? 'bg-butter-soft' : 'hover:bg-slate-50'}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        haptic();
                        onChange(v.name === list.voice ? null : v.name);
                        setOpen(false);
                      }}
                      className="flex min-h-10 flex-1 flex-col items-start justify-center text-left"
                    >
                      <span className="text-sm font-medium text-ink">
                        {v.name}
                        {v.name === list.voice && <span className="ml-1.5 text-[10px] font-normal text-slate-500">({t('card.default')})</span>}
                      </span>
                      <span className="text-[11px] text-slate-500">{v.style}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => preview(v.name)}
                      className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-600 hover:bg-slate-100"
                      aria-label={`${t('card.preview')} ${v.name}`}
                    >
                      {previewing === v.name ? (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
                      ) : (
                        <Play className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {err && <p className="border-t border-line px-4 py-2 text-[11px] text-rose-700">{err}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Reference "Plant Care Tutorial": a short trap-care guide in a sheet. */
function GuideCard() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const steps = [t('guide.1'), t('guide.2'), t('guide.3'), t('guide.4')];
  return (
    <>
      <Card className="relative flex min-h-[230px] flex-col overflow-hidden p-0!" aria-labelledby="guide-title">
        <div className="p-5 pb-0">
          <h2 id="guide-title" className="text-sm font-medium text-ink">
            {t('guide.title')}
          </h2>
          <p className="text-xs text-slate-500">{t('guide.by')}</p>
        </div>
        {/* illustration: a yellow sticky card on its stake */}
        <svg viewBox="0 0 160 140" className="mt-auto w-full" aria-hidden="true">
          <defs>
            <linearGradient id="gd-bg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f2f1ee" stopOpacity="0" />
              <stop offset="1" stopColor="#e7e1d2" />
            </linearGradient>
          </defs>
          <rect width="160" height="140" fill="url(#gd-bg)" />
          <rect x="78" y="40" width="4" height="100" rx="2" fill="#8b7355" />
          <g transform="rotate(-6 80 60)">
            <rect x="48" y="22" width="64" height="78" rx="8" fill="#f3c94a" stroke="#d9ab22" />
            {[[60, 40], [86, 34], [72, 58], [98, 66], [62, 80], [90, 86], [78, 44]].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r="2.2" fill="#3b2f25" opacity="0.7" />
            ))}
          </g>
          <ellipse cx="80" cy="136" rx="40" ry="5" fill="#000" opacity="0.08" />
        </svg>
        <motion.button
          type="button"
          whileTap={{ scale: 0.9 }}
          onClick={() => (haptic(), setOpen(true))}
          className="absolute bottom-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-surface text-ink shadow-[var(--elev-3)] ring-1 ring-line"
          aria-label={t('guide.open')}
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </motion.button>
      </Card>
      {createPortal(
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[75] flex items-end justify-center bg-black/35 p-4 backdrop-blur-[2px] sm:items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="guide-sheet-title"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
              initial={{ y: 40, opacity: 0, scale: 0.97 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={SPRING}
              className="w-full max-w-md rounded-[28px] bg-surface p-6 shadow-[var(--elev-4)] ring-1 ring-line"
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 id="guide-sheet-title" className="text-lg font-semibold text-ink">
                  {t('guide.title')}
                </h2>
                <button autoFocus type="button" onClick={() => setOpen(false)} className="grid h-10 w-10 place-items-center rounded-full hover:bg-slate-100" aria-label="Close">
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <ol className="flex flex-col gap-3">
                {steps.map((s, i) => (
                  <motion.li key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0, transition: { ...SPRING, delay: 0.08 * i } }} className="flex gap-3 text-sm text-slate-700">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-butter-soft text-xs font-semibold text-[#8a6a00]">{i + 1}</span>
                    {s}
                  </motion.li>
                ))}
              </ol>
              <p className="mt-4 text-[11px] text-slate-500">{t('guide.note')}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body
      )}
    </>
  );
}

const TAG = {
  capture: 'bg-butter-soft text-[#7a5d00] [:root[data-theme=dark]_&]:text-butter',
  action: 'bg-cocoa text-[#fff] [:root[data-theme=dark]_&]:text-[#2b231c]',
  change: 'bg-slate-100 text-slate-700',
};
const ICON = { capture: Camera, action: Leaf, change: TriangleAlert };

function RecentUpdates({ events, onSeeAll, onSelectCapture, className = '' }) {
  const t = useT();
  const rows = events.slice(-3).reverse();
  return (
    <Card className={className} aria-labelledby="updates-title">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="updates-title" className="text-xl font-medium tracking-tight text-ink">
          {t('card.updates')}
        </h2>
        <SeeAll onClick={onSeeAll}>{t('card.seeAll')}</SeeAll>
      </div>
      {rows.length === 0 ? (
        <p className="py-4 text-sm text-slate-500">{t('timeline.empty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((e) => {
            const Icon = ICON[e.kind] ?? Camera;
            const dec = decisionStyle(e.tag);
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => e.captureId && onSelectCapture(e.captureId)}
                  className="group grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 py-3 text-left sm:grid-cols-[auto_1fr_auto_auto_auto]"
                >
                  <span className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-slate-600">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="truncate text-sm font-medium text-ink">
                    {e.title}
                    {dec && (
                      <span className="ml-2 text-xs" style={{ color: dec.color }} aria-hidden="true">
                        {dec.shape}
                      </span>
                    )}
                  </span>
                  <span className={`hidden rounded-full px-3 py-1 text-xs font-medium sm:inline ${TAG[e.kind]}`}>{t(`tag.${e.kind}`)}</span>
                  <span className="hidden w-24 text-right text-sm text-slate-500 sm:inline">{e.at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                  <ArrowUpRight className="h-4 w-4 text-slate-500 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

