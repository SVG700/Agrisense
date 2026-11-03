import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  BatteryWarning,
  Bug,
  Clock,
  Cpu,
  Droplets,
  History,
  ScanSearch,
  ShieldAlert,
  Thermometer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import TrapCanvas from './TrapCanvas.jsx';
import AdvisoryCard from './AdvisoryCard.jsx';
import MicroclimateChart from './MicroclimateChart.jsx';
import Badge from './Badge.jsx';
import DecisionBadge from './DecisionBadge.jsx';
import TrapCards from './TrapCards.jsx';
import { decisionStyle } from '../lib/decision.js';
import { AnimatedNumber, EASE, Item, Reveal, Sparkline, Stagger, WordReveal, useTilt } from '../lib/motion.jsx';
import {
  DATA_SOURCES,
  LOW_BATTERY,
  RISK_STYLES,
  STALE_AFTER_MS,
  VISION_STATES,
  fmtReading,
  hasCounts,
  isSimulated,
  pestMeta,
  timeAgo,
  totalOf,
  visionStatus,
} from '../lib/pests.js';

const HEADLINES = {
  High: 'Outbreak risk is high',
  Medium: 'Pest pressure is building',
  Low: 'Pest pressure is low',
};

/** Farmer-facing analytics view. */
export default function FarmerDashboard({ device, devices = [], onSelectDevice, telemetry, onGoAdmin }) {
  // null = follow the latest capture; otherwise a pinned historic capture id
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => setSelectedId(null), [device?.id]);
  const trapRef = useRef(null);

  const latest = telemetry.at(-1) ?? null;
  const capture = telemetry.find((t) => t.id === selectedId) ?? latest;
  const isHistoric = Boolean(capture && latest && capture.id !== latest.id);
  const det = capture?.detection ?? null;
  const countsKnown = hasCounts(det);
  const counts = countsKnown ? det.pest_counts ?? {} : {};
  const total = totalOf(counts);
  const risk = det?.ai_advisory?.risk_level ?? null;

  // Trend vs the previous capture that actually has counts
  const counted = telemetry.filter((t) => hasCounts(t.detection));
  const prevCounted = counted.length >= 2 && capture?.id === counted.at(-1)?.id ? counted.at(-2) : null;
  const delta = prevCounted ? total - totalOf(prevCounted.detection.pest_counts) : null;

  // Real history for the KPI sparklines (most recent 20 points)
  const RISK_SCORE = { Low: 1, Medium: 2, High: 3 };
  const trends = {
    total: counted.map((t) => totalOf(t.detection.pest_counts)),
    temperature: telemetry.map((t) => t.temperature),
    humidity: telemetry.map((t) => t.humidity),
    risk: telemetry.map((t) => RISK_SCORE[t.detection?.ai_advisory?.risk_level]),
  };

  const stale = latest && Date.now() - new Date(latest.timestamp).getTime() > STALE_AFTER_MS;
  const vState = VISION_STATES[visionStatus(det)] ?? null;
  const source = DATA_SOURCES[capture?.data_source ?? 'unknown'] ?? DATA_SOURCES.unknown;

  return (
    <div className="flex flex-col gap-6">
      <AnimatePresence>
        {device && device.battery_level < LOW_BATTERY && (
          <motion.button
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE }}
            onClick={onGoAdmin}
            className="group flex items-center gap-3 rounded-2xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-left text-sm text-rose-200 transition hover:bg-rose-500/15"
          >
            <BatteryWarning className="h-5 w-5 shrink-0 animate-pulse" />
            <span>
              <b>{device.name}</b> is at {device.battery_level}% battery
              {device.battery_source === 'manual' ? ' (manually set)' : ''} - captures may stop soon. Open hardware
              control →
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {isSimulated(capture) && (
        <div
          role="note"
          data-testid="simulated-banner"
          className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100"
        >
          <Badge tone="warn">Simulated data</Badge>
          {capture.detection?.vision_meta?.status === 'simulated' && <Badge tone="warn">Demo detector</Badge>}
          <span className="text-amber-100/80">
            {capture.detection?.vision_meta?.fallback
              ? `The real detection model was unavailable (${capture.detection.vision_meta.fallback.error?.code ?? capture.detection.vision_meta.fallback.reason}), so these counts were simulated by the demo detector, not read from this photo.`
              : 'This capture was generated for demonstration, not photographed in a field. Counts and decisions show how the system behaves, not a real infestation.'}
          </span>
        </div>
      )}

      <Hero
        device={device}
        capture={capture}
        latest={latest}
        stale={stale}
        risk={risk}
        countsKnown={countsKnown}
        total={total}
        onViewTrap={() => trapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        onGoAdmin={onGoAdmin}
        decision={det?.ai_advisory?.decision}
      />

      <TrapCards devices={devices} activeId={device?.id} onSelect={onSelectDevice} refreshKey={latest?.id} />

      {/* Provenance strip: what the numbers below are */}
      {capture && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="flex flex-wrap items-center gap-2 text-xs text-slate-400"
        >
          <span className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" />
            {isHistoric ? 'Viewing historical capture' : 'Latest capture'} · {new Date(capture.timestamp).toLocaleString()} (
            {timeAgo(capture.timestamp)})
          </span>
          {isHistoric && (
            <button onClick={() => setSelectedId(null)} className="text-emerald-300 underline-offset-2 hover:underline">
              back to latest
            </button>
          )}
          {stale && !isHistoric && <Badge tone="bad">Stale - no capture for {timeAgo(latest.timestamp).replace(' ago', '')}</Badge>}
          {vState && (
            <Badge tone={vState.tone} title={vState.help}>
              Detections: {vState.label}
            </Badge>
          )}
          <Badge tone={source.tone}>Readings: {source.label}</Badge>
        </motion.div>
      )}

      {/* KPI row */}
      <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4" stagger={0.07} delay={0.1}>
        <Stat
          icon={Bug}
          label="Insects trapped"
          trend={trends.total}
          trendColor="#a3e635"
          value={!capture ? '—' : countsKnown ? <AnimatedNumber value={total} /> : 'Not counted'}
          sub={
            delta !== null ? (
              <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${delta > 0 ? 'bg-rose-500/10 text-rose-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
                {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                {delta > 0 ? '+' : ''}
                {delta} vs previous
              </span>
            ) : null
          }
        />
        <Stat
          icon={Thermometer}
          label="Temperature"
          trend={trends.temperature}
          trendColor="#fb923c"
          value={capture && capture.temperature !== null ? <AnimatedNumber value={capture.temperature} decimals={1} suffix="°C" /> : '—'}
        />
        <Stat
          icon={Droplets}
          label="Humidity"
          trend={trends.humidity}
          trendColor="#38bdf8"
          value={capture && capture.humidity !== null ? <AnimatedNumber value={capture.humidity} decimals={0} suffix="%" /> : fmtReading(null)}
        />
        <Stat icon={ShieldAlert} label="Risk level" trend={trends.risk} trendColor="#f87171" value={<span className={RISK_STYLES[risk]?.text}>{risk ?? '—'}</span>} />
      </Stagger>

      <Stagger className="grid gap-6 lg:grid-cols-5" stagger={0.08} delay={0.2}>
        <Item className="flex min-w-0 flex-col gap-6 lg:col-span-3">
          <div ref={trapRef} className="scroll-mt-6">
            <TrapCanvas capture={capture} />
          </div>
          <PestBreakdown counts={counts} total={total} known={countsKnown} reason={vState?.help} />
        </Item>
        <Item className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <AdvisoryCard advisory={det?.ai_advisory} />
          <CaptureHistory telemetry={telemetry} selectedId={capture?.id} latestId={latest?.id} onSelect={setSelectedId} />
        </Item>
      </Stagger>

      <Reveal>
        <MicroclimateChart telemetry={telemetry} />
      </Reveal>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Summary banner built only from the selected capture's real data. */
function Hero({ device, capture, latest, stale, risk, countsKnown, total, onViewTrap, onGoAdmin, decision }) {
  const headline = !capture ? 'Waiting for the first trap capture' : HEADLINES[risk] ?? 'Awaiting pest analysis';
  const style = RISK_STYLES[risk];
  const boxes = (capture?.detection?.bounding_boxes ?? []).slice(0, 40);

  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE }}
      className="card aurora-border relative overflow-hidden p-6! sm:p-8!"
    >
      {/* soft brand wash */}
      <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 left-1/3 h-64 w-64 rounded-full bg-lime-500/10 blur-3xl" />

      <div className="relative flex flex-col items-start gap-8 md:flex-row md:items-center md:justify-between">
        <Stagger className="flex max-w-xl flex-col gap-3" stagger={0.08} delay={0.1}>
          <Item className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-2.5 py-1 font-medium text-emerald-300 ring-1 ring-emerald-500/30">
              <span className={`live-dot ${stale ? 'text-amber-400' : 'text-emerald-400'}`} />
              {device?.name ?? 'No trap selected'}
            </span>
            {latest && <span className="text-slate-500">Last capture {timeAgo(latest.timestamp)}</span>}
            {decision?.decision && <DecisionBadge decision={decision.decision} borderline={decision.borderline} />}
          </Item>
          <Item as="h2" className="text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl">
            <WordReveal text={headline} wordClassName="text-shine" delay={0.15} />
            {style && <span className={`ml-2 inline-block h-3 w-3 translate-y-[-0.35em] rounded-full ${style.dot}`} />}
          </Item>
          <Item as="p" className="text-sm leading-relaxed text-slate-400 sm:text-base">
            {!capture
              ? 'Send a capture from the edge device or the Hardware tab to start monitoring.'
              : countsKnown
                ? `${total} insect${total === 1 ? '' : 's'} counted on the ${capture.id === latest?.id ? 'latest' : 'selected'} sticky-trap image. Review the detections and the advisory below.`
                : 'Insects were not counted for this capture. Sensor readings and the trap image are still recorded below.'}
          </Item>
          <Item className="mt-2 flex flex-wrap gap-3">
            <button onClick={onViewTrap} className="btn btn-primary" disabled={!capture}>
              <ScanSearch className="h-4 w-4" /> View detections
            </button>
            <button onClick={onGoAdmin} className="btn btn-ghost">
              <Cpu className="h-4 w-4" /> Hardware control <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Item>
        </Stagger>

        <TrapRadar boxes={boxes} />
      </div>
    </motion.section>
  );
}

/** Decorative radar whose blips are the real detection centres of the capture. */
function TrapRadar({ boxes }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.7, ease: EASE, delay: 0.2 }}
      className="relative hidden h-44 w-44 shrink-0 md:block lg:h-52 lg:w-52"
      aria-hidden="true"
    >
      <svg viewBox="0 0 200 200" className="float-slow h-full w-full">
        <defs>
          <radialGradient id="radar-bg" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgb(16 185 129 / 0.18)" />
            <stop offset="100%" stopColor="rgb(16 185 129 / 0)" />
          </radialGradient>
          <linearGradient id="radar-sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(52 211 153 / 0)" />
            <stop offset="100%" stopColor="rgb(52 211 153 / 0.45)" />
          </linearGradient>
          <clipPath id="radar-clip">
            <circle cx="100" cy="100" r="92" />
          </clipPath>
        </defs>
        <circle cx="100" cy="100" r="92" fill="url(#radar-bg)" stroke="rgb(52 211 153 / 0.35)" />
        {[66, 40, 14].map((r) => (
          <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="rgb(52 211 153 / 0.18)" strokeDasharray="2 4" />
        ))}
        <line x1="8" y1="100" x2="192" y2="100" stroke="rgb(52 211 153 / 0.12)" />
        <line x1="100" y1="8" x2="100" y2="192" stroke="rgb(52 211 153 / 0.12)" />
        <g clipPath="url(#radar-clip)">
          <g className="radar-sweep">
            <path d="M100 100 L192 100 A92 92 0 0 0 165 35 Z" fill="url(#radar-sweep)" />
          </g>
          {boxes.map((b, i) => {
            const cx = 8 + (b.x + b.width / 2) * 184;
            const cy = 8 + (b.y + b.height / 2) * 184;
            return (
              <circle
                key={i}
                cx={cx}
                cy={cy}
                r="2.6"
                fill={pestMeta(b.label).color}
                style={{ animation: `bbox-in 400ms cubic-bezier(.22,1,.36,1) ${300 + i * 25}ms both`, transformBox: 'fill-box', transformOrigin: 'center' }}
              />
            );
          })}
        </g>
      </svg>
    </motion.div>
  );
}

function Stat({ icon: Icon, label, value, sub, trend = [], trendColor }) {
  const tilt = useTilt(5);
  return (
    <Item className="card card-hover flex flex-col gap-3 p-4! sm:p-5!" {...tilt}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-400">{label}</span>
        <span className="icon-chip h-8! w-8! rounded-lg!">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div
        className={`font-semibold tabular-nums tracking-tight text-white ${
          typeof value === 'string' && value.length > 3 ? 'text-lg sm:text-xl' : 'text-2xl sm:text-3xl'
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs">{sub}</div>}
      {/* Trend of this metric over recent captures (real data) */}
      <Sparkline values={trend} color={trendColor} height={28} className="-mx-1 mt-auto opacity-90" />
    </Item>
  );
}

function PestBreakdown({ counts, total, known, reason }) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <section className="card card-hover">
      <h2 className="card-title mb-5">
        <span className="icon-chip h-8! w-8! rounded-lg!">
          <Bug className="h-4 w-4" />
        </span>
        Species Breakdown
      </h2>
      {!known ? (
        <p className="text-sm text-slate-500">{reason ?? 'No detections yet.'}</p>
      ) : entries.length === 0 || total === 0 ? (
        <p className="text-sm text-slate-500">No insects detected in this capture.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map(([label, n], i) => {
            const meta = pestMeta(label);
            const pct = total ? (n / total) * 100 : 0;
            return (
              <div key={label} className="group">
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-200">
                    <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/5" style={{ background: meta.color }} />
                    {meta.name}
                  </span>
                  <span className="tabular-nums text-slate-400">
                    <AnimatedNumber value={n} /> <span className="text-xs">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800/80">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: `linear-gradient(90deg, ${meta.color}aa, ${meta.color})`, boxShadow: `0 0 12px ${meta.color}55` }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.7, ease: EASE, delay: 0.1 + i * 0.06 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CaptureHistory({ telemetry, selectedId, latestId, onSelect }) {
  const recent = telemetry.slice(-8).reverse();
  return (
    <section className="card card-hover">
      <h2 className="card-title mb-3">
        <span className="icon-chip h-8! w-8! rounded-lg!">
          <History className="h-4 w-4" />
        </span>
        Recent Captures
      </h2>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing captured yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          <AnimatePresence initial={false}>
            {recent.map((t, i) => {
              const risk = t.detection?.ai_advisory?.risk_level;
              const dec = decisionStyle(t.detection?.ai_advisory?.decision?.decision);
              const vs = visionStatus(t.detection);
              const selected = t.id === selectedId;
              return (
                <motion.li
                  key={t.id}
                  layout
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0, transition: { duration: 0.35, ease: EASE, delay: i * 0.03 } }}
                  exit={{ opacity: 0, x: 12 }}
                >
                  <button
                    onClick={() => onSelect(t.id === latestId ? null : t.id)}
                    className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-all duration-200 ${
                      selected ? 'bg-emerald-500/15 ring-1 ring-emerald-500/40' : 'hover:translate-x-0.5 hover:bg-slate-800/60'
                    }`}
                  >
                    {dec ? (
                      <span className="w-3 shrink-0 text-center text-xs leading-none" style={{ color: dec.color }} title={dec.label}>
                        {dec.shape}
                      </span>
                    ) : (
                      <span className={`h-2 w-2 shrink-0 rounded-full ${RISK_STYLES[risk]?.dot ?? 'bg-slate-500'}`} />
                    )}
                    <span className="tabular-nums text-slate-300">{new Date(t.timestamp).toLocaleTimeString()}</span>
                    {vs === 'simulated' && <span className="text-[10px] uppercase tracking-wide text-amber-300/80">sim</span>}
                    <span className="ml-auto truncate tabular-nums text-slate-400">
                      {hasCounts(t.detection) ? `${totalOf(t.detection.pest_counts)} bugs` : VISION_STATES[vs]?.label} ·{' '}
                      {fmtReading(t.temperature, 0, '°C')} · {fmtReading(t.humidity, 0, '%')}
                    </span>
                  </button>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </section>
  );
}
