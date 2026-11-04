import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BatteryWarning,
  Bug,
  Clock,
  Droplets,
  History,
  ShieldAlert,
  Thermometer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import TrapCanvas from './TrapCanvas.jsx';
import AdvisoryCard from './AdvisoryCard.jsx';
import MicroclimateChart from './MicroclimateChart.jsx';
import Badge from './Badge.jsx';
import TrapCards from './TrapCards.jsx';
import ManualSprayCard from './ManualSprayCard.jsx';
import Field3D from './Field3D.jsx';
import DailyTimeline from './DailyTimeline.jsx';
import LiveVision from './LiveVision.jsx';
import { HeroCards, TrapStage, VISION_LAYOUT_ID } from './FieldHero.jsx';
import { LayoutGroup } from 'framer-motion';
import { buildEvents } from '../lib/events.js';
import { useLiveWeather } from '../lib/place.js';
import { useT } from '../lib/i18n.jsx';
import WeatherCard from './WeatherCard.jsx';
import WhatIfCard from './WhatIfCard.jsx';
import ImpactCard from './ImpactCard.jsx';
import ActionLogCard from './ActionLogCard.jsx';
import { api } from '../api.js';
import { decisionStyle } from '../lib/decision.js';
import { AnimatedNumber, EASE, Item, Reveal, Sparkline, Stagger } from '../lib/motion.jsx';
import { SECTIONS } from '../lib/theme.js';
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
const DEFAULT_LAYOUT = { order: SECTIONS.map((s) => s.id), hidden: [] };

/**
 * Farmer-facing dashboard: header + day strip, the three glow cards, the
 * trap status row, then the sections in the viewer's chosen order (Customize).
 */
export default function FarmerDashboard({
  device,
  devices = [],
  onSelectDevice,
  telemetry,
  health,
  onGoAdmin,
  layout = DEFAULT_LAYOUT,
  live = true,
  onToggleLive,
  onCustomize,
  onAddTrap,
}) {
  const t = useT();
  // null = follow the latest capture; otherwise a pinned historic capture id
  const [selectedId, setSelectedId] = useState(null);
  useEffect(() => setSelectedId(null), [device?.id]);
  const trapRef = useRef(null);
  const sectionRefs = useRef({});
  const [vision, setVision] = useState(null); // {x, y} press point while Live Vision is open
  const weather = useLiveWeather();
  const outside = weather.data?.available ? weather.data : null;

  const latest = telemetry.at(-1) ?? null;
  const capture = telemetry.find((t) => t.id === selectedId) ?? latest;
  const index = capture ? telemetry.findIndex((t) => t.id === capture.id) : -1;
  const stepCapture = (dir) => {
    const next = telemetry[index + dir];
    if (next) setSelectedId(next.id === latest?.id ? null : next.id);
  };

  // Action log for this trap (shared by the log card, the spray button, the timeline and the chart markers)
  const [actions, setActions] = useState([]);
  const [actionsUnavailable, setActionsUnavailable] = useState(null);
  const loadActions = async () => {
    if (!device?.id) return;
    try {
      setActions(await api.actions(device.id));
      setActionsUnavailable(null);
    } catch (err) {
      setActions([]);
      setActionsUnavailable(err.code === 'actions_unavailable' ? err.message : null);
    }
  };
  useEffect(() => {
    setActions([]);
    loadActions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device?.id]);
  const isHistoric = Boolean(capture && latest && capture.id !== latest.id);
  const det = capture?.detection ?? null;
  const countsKnown = hasCounts(det);
  const counts = countsKnown ? det.pest_counts ?? {} : {};
  const total = totalOf(counts);
  const risk = det?.ai_advisory?.risk_level ?? null;
  const decision = det?.ai_advisory?.decision ?? null;

  // Trend vs the previous capture that actually has counts
  const counted = telemetry.filter((t) => hasCounts(t.detection));
  const prevCounted = counted.length >= 2 && capture?.id === counted.at(-1)?.id ? counted.at(-2) : null;
  const delta = prevCounted ? total - totalOf(prevCounted.detection.pest_counts) : null;

  // Real history for the KPI sparklines
  const RISK_SCORE = { Low: 1, Medium: 2, High: 3 };
  const trends = {
    total: counted.map((t) => totalOf(t.detection.pest_counts)),
    temperature: telemetry.map((t) => t.temperature),
    humidity: telemetry.map((t) => t.humidity),
    risk: telemetry.map((t) => RISK_SCORE[t.detection?.ai_advisory?.risk_level]),
  };

  const stale = latest && Date.now() - new Date(latest.timestamp).getTime() > STALE_AFTER_MS;
  const quality = det?.vision_meta?.quality ?? null;
  const poorPhoto = det?.vision_meta?.error?.code === 'poor_image';
  const vState = poorPhoto
    ? { label: 'Photo rejected', tone: 'bad', help: det.vision_meta.error.message }
    : VISION_STATES[visionStatus(det)] ?? null;
  const source = DATA_SOURCES[capture?.data_source ?? 'unknown'] ?? DATA_SOURCES.unknown;
  const latestDecision = latest?.detection?.ai_advisory?.decision;
  const headline = !capture
    ? t('hero.waiting')
    : decision?.decision === 'CHECK_TRAP'
      ? t('hero.check')
      : HEADLINES[risk]
        ? t(`hero.${risk}`)
        : t('hero.awaiting');
  const events = buildEvents(telemetry, actions);
  const seeSection = (id) => sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const selectCapture = (id) => setSelectedId(id === latest?.id ? null : id);

  const sections = {
    glance: (
      <section aria-labelledby="glance-title" className="flex flex-col gap-4">
        <SectionHead id="glance-title" label={t('section.glance')}>
          {capture && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {isHistoric ? 'Viewing historical capture' : 'Latest capture'} · {new Date(capture.timestamp).toLocaleString()} ({timeAgo(capture.timestamp)})
              </span>
              {isHistoric && (
                <button onClick={() => setSelectedId(null)} className="font-medium text-brand underline-offset-2 hover:underline">
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
              {quality && <QualityBadge quality={quality} />}
            </div>
          )}
        </SectionHead>

        <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4" stagger={0.06} delay={0.05}>
          <Stat
            icon={Bug}
            label={t('kpi.insects')}
            trend={trends.total}
            trendColor="#22c55e"
            value={!capture ? '—' : countsKnown ? <AnimatedNumber value={total} /> : t('kpi.notCounted')}
            sub={
              delta !== null ? (
                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 ${delta > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                  {delta > 0 ? <TrendingUp className="h-3 w-3" aria-hidden="true" /> : <TrendingDown className="h-3 w-3" aria-hidden="true" />}
                  {delta > 0 ? '+' : ''}
                  {delta} vs previous
                </span>
              ) : null
            }
          />
          <Stat
            icon={Thermometer}
            label={t('kpi.temperature')}
            trend={trends.temperature}
            trendColor="#f97316"
            value={capture && capture.temperature !== null ? <AnimatedNumber value={capture.temperature} decimals={1} suffix="°C" /> : '—'}
            sub={outside ? <OutsideNow value={`${outside.temperature.toFixed(1)}°C`} where={outside.location?.label} /> : null}
          />
          <Stat
            icon={Droplets}
            label={t('kpi.humidity')}
            trend={trends.humidity}
            trendColor="#0ea5e9"
            value={capture && capture.humidity !== null ? <AnimatedNumber value={capture.humidity} decimals={0} suffix="%" /> : fmtReading(null)}
            sub={outside ? <OutsideNow value={`${Math.round(outside.humidity)}%`} where={outside.location?.label} /> : null}
          />
          <Stat
            icon={ShieldAlert}
            label={t('kpi.risk')}
            trend={trends.risk}
            trendColor="#f43f5e"
            value={<span className={RISK_STYLES[risk]?.text}>{risk ? t(`risk.${risk}`) : '—'}</span>}
          />
        </Stagger>
      </section>
    ),
    timeline: <DailyTimeline telemetry={telemetry} actions={actions} capture={capture} onSelectCapture={selectCapture} />,
    detections: (
      <section aria-labelledby="detections-title" className="flex flex-col gap-4">
        <SectionHead id="detections-title" label={t('section.detections')} />
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-3">
            <div ref={trapRef} className="scroll-mt-24">
              <TrapCanvas capture={capture} />
            </div>
            <PestBreakdown counts={counts} total={total} known={countsKnown} reason={vState?.help} live={!isHistoric} />
          </div>
          <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
            <AdvisoryCard advisory={det?.ai_advisory} />
            <ManualSprayCard device={device} decision={latestDecision} onChanged={loadActions} />
            <WeatherCard deviceId={device?.id} decision={latestDecision} />
          </div>
        </div>
      </section>
    ),
    field3d: <Field3D devices={devices} activeId={device?.id} onSelect={onSelectDevice} refreshKey={latest?.id} />,
    traps: (
      <section aria-labelledby="traps-title" className="flex flex-col gap-4">
        <SectionHead id="traps-title" label={t('section.traps')} />
        <TrapCards devices={devices} activeId={device?.id} onSelect={onSelectDevice} refreshKey={latest?.id} />
        <ImpactCard refreshKey={latest?.id} />
      </section>
    ),
    log: (
      <div className="grid gap-6 lg:grid-cols-2">
        <ActionLogCard deviceId={device?.id} decision={latestDecision} actions={actions} unavailable={actionsUnavailable} onChanged={loadActions} />
        <CaptureHistory telemetry={telemetry} selectedId={capture?.id} latestId={latest?.id} onSelect={setSelectedId} />
      </div>
    ),
    whatif: <WhatIfCard deviceId={device?.id} />,
    climate: <MicroclimateChart telemetry={telemetry} actions={actions} />,
  };

  return (
    <div className="flex flex-col gap-8">
      <AnimatePresence>
        {device && device.battery_level < LOW_BATTERY && (
          <motion.button
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3, ease: EASE }}
            onClick={onGoAdmin}
            className="flex items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm text-rose-800 transition hover:bg-rose-100"
          >
            <BatteryWarning className="h-5 w-5 shrink-0" aria-hidden="true" />
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
          className="-my-2 flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900"
        >
          <Badge tone="warn">{t('simulatedData')}</Badge>
          {capture.detection?.vision_meta?.status === 'simulated' && <Badge tone="warn">{t('demoDetector')}</Badge>}
          <span>
            {capture.detection?.vision_meta?.fallback
              ? `The real detection model was unavailable (${capture.detection.vision_meta.fallback.error?.code ?? capture.detection.vision_meta.fallback.reason}), so these counts were simulated by the demo detector, not read from this photo.`
              : t('banner.simulated')}
          </span>
        </div>
      )}

      <LayoutGroup id="vision">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:items-start [&>*]:min-w-0">
          <TrapStage
            device={device}
            devices={devices}
            capture={capture}
            decision={decision}
            index={index}
            count={telemetry.length}
            onStep={stepCapture}
            onSelectDevice={onSelectDevice}
            onAddTrap={onAddTrap}
            onOpenVision={setVision}
            visionOpen={Boolean(vision)}
          />
          <HeroCards device={device} capture={capture} telemetry={telemetry} decision={decision} events={events} onSeeAll={seeSection} onSelectCapture={selectCapture} weather={weather} />
        </div>
        <LiveVision open={Boolean(vision)} origin={vision} onClose={() => setVision(null)} device={device} capture={capture} layoutId={VISION_LAYOUT_ID} />
      </LayoutGroup>

      {layout.order
        .filter((id) => !layout.hidden.includes(id) && sections[id])
        .map((id) => (
          <Reveal key={id} y={16}>
            <div ref={(el) => (sectionRefs.current[id] = el)} className="scroll-mt-28">
              {sections[id]}
            </div>
          </Reveal>
        ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** "Outside now 24.6°C · Hesaraghatta" under a trap reading (live Open-Meteo value). */
function OutsideNow({ value, where }) {
  const t = useT();
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-slate-500" title={where ?? undefined}>
      <span className="live-dot text-emerald-500" aria-hidden="true" />
      <span className="truncate">
        {t('place.outside')} <b className="font-semibold text-ink">{value}</b>
        {where ? ` · ${where.split(',')[0]}` : ''}
      </span>
    </span>
  );
}

function SectionHead({ id, label, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id={id} className="pill-label">
        {label}
      </h2>
      {children}
    </div>
  );
}

const ISSUE_LABELS = { blurry: 'blurry', dark: 'too dark', bright: 'overexposed', glare: 'glare' };

/** Photo-quality verdict for an uploaded trap photo (metrics in the tooltip). */
function QualityBadge({ quality }) {
  const m = quality.metrics ?? {};
  const detail = `Sharpness ${m.sharpness}, brightness ${m.brightness}, glare ${Math.round((m.glare_fraction ?? 0) * 100)}% (placeholder thresholds)`;
  return quality.ok ? (
    <Badge tone="good" title={detail}>
      Photo quality OK
    </Badge>
  ) : (
    <Badge tone="bad" title={`${quality.advice?.join(' ') ?? ''} ${detail}`} data-testid="quality-badge">
      Photo: {quality.issues.map((i) => ISSUE_LABELS[i] ?? i).join(', ')} - retake
    </Badge>
  );
}

function Stat({ icon: Icon, label, value, sub, trend = [], trendColor }) {
  return (
    <Item className="card card-hover flex flex-col gap-2 p-5!">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-600">{label}</span>
        <span className="icon-chip h-8! w-8! rounded-lg!">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <div className={`font-semibold tabular-nums tracking-tight text-ink ${typeof value === 'string' && value.length > 3 ? 'text-xl' : 'text-4xl'}`}>
        {value}
      </div>
      {sub && <div className="text-xs">{sub}</div>}
      <Sparkline values={trend} color={trendColor} height={28} className="-mx-1 mt-auto" />
    </Item>
  );
}

/** Share of each species on the shown capture; re-animates whenever a new capture arrives. */
function PestBreakdown({ counts, total, known, reason, live }) {
  const t = useT();
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <section className="card card-hover" aria-labelledby="species-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <h2 id="species-title" className="card-title">
          <span className="icon-chip h-8! w-8! rounded-lg!">
            <Bug className="h-4 w-4" aria-hidden="true" />
          </span>
          {t('species.title')}
        </h2>
        {live && known && (
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
            <span className="live-dot text-emerald-500" aria-hidden="true" />
            {t('species.live')}
          </span>
        )}
      </div>
      {!known ? (
        <p className="text-sm text-slate-500">{reason ?? 'No detections yet.'}</p>
      ) : entries.length === 0 || total === 0 ? (
        <p className="text-sm text-slate-500">{t('species.none')}</p>
      ) : (
        <ul className="flex flex-col gap-4" aria-live="polite">
          {entries.map(([label, n], i) => {
            const meta = pestMeta(label);
            const pct = total ? (n / total) * 100 : 0;
            return (
              <li key={label}>
                <div className="mb-1.5 flex justify-between text-sm">
                  <span className="flex items-center gap-2 font-medium text-slate-800">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta.color }} aria-hidden="true" />
                    {meta.name}
                  </span>
                  <span className="tabular-nums text-slate-600">
                    <AnimatedNumber value={n} /> <span className="text-xs">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="presentation">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: meta.color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.6, ease: EASE, delay: 0.05 + i * 0.05 }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
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
          <History className="h-4 w-4" aria-hidden="true" />
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
                    aria-pressed={selected}
                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors duration-200 ${
                      selected ? 'bg-brand-soft ring-1 ring-emerald-200' : 'hover:bg-slate-50'
                    }`}
                  >
                    {dec ? (
                      <span className="w-3 shrink-0 text-center text-xs leading-none" style={{ color: dec.color }} title={dec.label}>
                        {dec.shape}
                      </span>
                    ) : (
                      <span className={`h-2 w-2 shrink-0 rounded-full ${RISK_STYLES[risk]?.dot ?? 'bg-slate-400'}`} />
                    )}
                    <span className="tabular-nums text-slate-700">{new Date(t.timestamp).toLocaleTimeString()}</span>
                    {vs === 'simulated' && <span className="text-[10px] uppercase tracking-wide text-amber-800">sim</span>}
                    <span className="ml-auto truncate tabular-nums text-slate-600">
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
