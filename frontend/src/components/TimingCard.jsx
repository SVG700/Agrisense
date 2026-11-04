import { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Bell, CalendarPlus, CloudRain, Droplets, Leaf, ScanSearch, SprayCan, Thermometer, Timer, Wind } from 'lucide-react';
import { api } from '../api.js';
import Badge from './Badge.jsx';
import { useT } from '../lib/i18n.jsx';

const SPRING = { type: 'spring', stiffness: 240, damping: 28 };
const DAY = 86_400_000;
const STAGE_COLORS = {
  egg: '#e7d9a8',
  crawler: '#e11d48',
  young_nymph: '#f59e0b',
  late_nymph: '#84cc16',
  adult: '#64748b',
};
const ACTION = {
  spray: { icon: SprayCan, tone: 'bg-rose-600 text-[#fff]', label: 'timing.spray' },
  release: { icon: Leaf, tone: 'bg-amber-500 text-[#1a1206]', label: 'timing.release' },
  scout: { icon: ScanSearch, tone: 'bg-emerald-600 text-[#fff]', label: 'timing.scout' },
};

/**
 * Targeted timing: the pest lifecycle forecast (GET /api/lifecycle) turned into
 * WHEN to act - a time chip, a 7-day stage track with the humidity forecast
 * and the target pinned on it, conditions at that hour, calendar + reminder.
 */
export default function TimingCard({ device, data }) {
  const t = useT();
  const [note, setNote] = useState(null);

  const tz = data?.timezone || 'Asia/Kolkata';
  const fmt = (iso, o) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, ...o }).format(new Date(iso));
  const target = data?.target;
  const A = target ? ACTION[target.action] : null;

  const addToCalendar = () => {
    const start = new Date(target.at);
    const end = new Date(start.getTime() + 60 * 60_000);
    const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//AgriSense//Treatment timing//EN',
      'BEGIN:VEVENT',
      `UID:${device.id}-${stamp(start)}@agrisense`,
      `DTSTAMP:${stamp(new Date())}`,
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${t(A.label)} - ${device.name}`,
      `DESCRIPTION:${data.headline.replace(/[,;\\]/g, (c) => `\\${c}`)}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',
      'ACTION:DISPLAY',
      `DESCRIPTION:${t(A.label)} in 1 hour`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `agrisense-${target.action}-${fmt(target.at, { day: '2-digit', month: 'short' }).replace(' ', '-')}.ics` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const remind = async () => {
    try {
      const r = await api.remind({ device_id: device.id, at: target.at, text: data.headline });
      setNote(t('timing.reminded', { when: fmt(r.remind_at, { hour: '2-digit', minute: '2-digit', hour12: true, weekday: 'short' }) }));
    } catch (err) {
      setNote(err.status === 401 || err.status === 403 ? t('timing.needKey') : err.message);
    }
  };

  return (
    <section className="card relative overflow-hidden p-0!" aria-labelledby="timing-title" data-testid="timing-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id="timing-title" className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <Timer className="h-4 w-4" aria-hidden="true" />
            </span>
            {t('timing.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-600">{t('timing.sub')}</p>
        </div>
        <Badge tone="warn" title={t('timing.modelHelp')}>
          {t('timing.model')}
        </Badge>
      </div>

      <div className="p-5">
        {!data ? (
          <div className="h-44 animate-pulse rounded-2xl bg-slate-100" />
        ) : !data.available ? (
          <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600 ring-1 ring-line">{data.reason}</p>
        ) : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
              {target && A && (
                <div className={`flex shrink-0 items-center gap-3 rounded-2xl px-4 py-3 shadow-[var(--elev-2)] ${A.tone}`}>
                  <A.icon className="h-6 w-6" aria-hidden="true" />
                  <div className="leading-tight">
                    <div className="text-[11px] font-semibold uppercase tracking-wider opacity-85">{t(A.label)}</div>
                    <div className="text-2xl font-semibold tabular-nums">{target.projected ? fmt(target.at, { weekday: 'short', day: 'numeric', month: 'short' }) : fmt(target.at, { hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()}</div>
                    {!target.projected && <div className="text-xs opacity-90">{fmt(target.at, { weekday: 'long', day: 'numeric', month: 'short' })}</div>}
                  </div>
                </div>
              )}
              <p className="text-base font-medium leading-snug text-ink" aria-live="polite">
                {data.headline}
              </p>
            </div>

            <Track data={data} fmt={fmt} />

            {target && (target.temp != null || target.rh != null) && (
              <ul className="flex flex-wrap gap-2 text-xs" aria-label={t('timing.conditions')}>
                {target.temp != null && <Cond icon={Thermometer} text={`${Math.round(target.temp)}°C`} />}
                {target.rh != null && <Cond icon={Droplets} text={`${target.rh}% RH`} />}
                {target.wind_kmh != null && <Cond icon={Wind} text={`${Math.round(target.wind_kmh)} km/h`} />}
                {target.rain_probability != null && <Cond icon={CloudRain} text={`${target.rain_probability}% ${t('timing.rain')}`} />}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {target && (
                <>
                  <button type="button" className="btn btn-primary" onClick={addToCalendar}>
                    <CalendarPlus className="h-4 w-4" aria-hidden="true" /> {t('timing.calendar')}
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={remind}>
                    <Bell className="h-4 w-4" aria-hidden="true" /> {t('timing.remind')}
                  </button>
                </>
              )}
              {note && (
                <span role="status" className="text-xs text-slate-600">
                  {note}
                </span>
              )}
            </div>

            <p className="text-[11px] leading-snug text-slate-500">
              {t('timing.footnote', { from: data.cohort?.from ?? '—', dd: data.cohort?.degree_days_so_far ?? 0 })}
            </p>
          </motion.div>
        )}
      </div>
    </section>
  );
}

function Cond({ icon: Icon, text }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-slate-700">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {text}
    </li>
  );
}

/** 7-day track: stage bands, the humidity forecast over them, spike + target pins. */
function Track({ data, fmt }) {
  const t = useT();
  const reduce = useReducedMotion();
  const start = data.forecast[0] ? Date.parse(data.forecast[0].t) : Date.now();
  const end = start + 7 * DAY;
  const x = (iso) => Math.min(100, Math.max(0, ((Date.parse(iso) - start) / (end - start)) * 100));
  const bands = data.stages
    .filter((s) => s.start)
    .map((s) => ({ ...s, x0: x(s.start), x1: s.end ? x(s.end) : 100 }))
    .filter((s) => s.x1 > s.x0);
  const rhPath = useMemo(() => {
    // 0-100 % RH drawn between 18 % and 92 % of the height, clear of the labels and edges
    const pts = data.forecast.filter((p) => p.rh != null).map((p) => [x(p.t), 92 - p.rh * 0.74]);
    return pts.length ? `M${pts.map((p) => p.map((v) => v.toFixed(2)).join(' ')).join(' L')}` : '';
  }, [data.forecast]); // eslint-disable-line react-hooks/exhaustive-deps
  const ticks = Array.from({ length: 8 }, (_, i) => start + i * DAY);
  const adult = data.stages.find((s) => s.id === 'adult');

  return (
    <div>
      <div className="relative h-28 overflow-hidden rounded-2xl bg-slate-50 ring-1 ring-line" role="img" aria-label={t('timing.trackAria', { stage: t(`stage.${data.stage_now}`) })}>
        {/* stage bands */}
        {bands.map((b, i) => (
          <motion.div
            key={b.id}
            className="absolute bottom-0 top-0"
            style={{
              left: `${b.x0}%`,
              width: `${b.x1 - b.x0}%`,
              background: b.vulnerable
                ? `repeating-linear-gradient(135deg, ${STAGE_COLORS[b.id]}33 0 6px, ${STAGE_COLORS[b.id]}1a 6px 12px)`
                : `${STAGE_COLORS[b.id]}22`,
              borderLeft: `2px solid ${STAGE_COLORS[b.id]}`,
            }}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: i * 0.06 }}
          >
            <span className="absolute left-1.5 top-1.5 whitespace-nowrap text-[10px] font-semibold" style={{ color: STAGE_COLORS[b.id] === '#e7d9a8' ? '#8a6a00' : STAGE_COLORS[b.id] }}>
              {t(`stage.${b.id}`)}
              {b.vulnerable ? ` · ${t('timing.vulnerable')}` : ''}
            </span>
          </motion.div>
        ))}
        {/* humidity forecast */}
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <motion.path d={rhPath} fill="none" stroke="#0ea5e9" strokeWidth="1.2" vectorEffect="non-scaling-stroke" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }} />
        </svg>
        {data.humidity_spike && (
          <span className="absolute bottom-2 -translate-x-1/2 rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-semibold text-[#fff] shadow" style={{ left: `${x(data.humidity_spike.at)}%` }} title={`${data.humidity_spike.rh_from}% → ${data.humidity_spike.rh_to}%`}>
            <Droplets className="mr-0.5 inline h-3 w-3" aria-hidden="true" />
            {data.humidity_spike.rh_to}%
          </span>
        )}
        {data.target && !data.target.projected && (
          <span className="absolute bottom-0 top-0 w-0.5 bg-ink" style={{ left: `${x(data.target.at)}%` }} aria-hidden="true">
            <span className="absolute -top-0 left-1/2 h-3 w-3 -translate-x-1/2 rounded-full bg-ink ring-4 ring-ink/15" />
            {!reduce && <span className="absolute -top-0 left-1/2 h-3 w-3 -translate-x-1/2 animate-ping rounded-full bg-ink/40" />}
          </span>
        )}
        {adult?.start && Date.parse(adult.start) > end && (
          <span className="absolute bottom-2 right-2 rounded-full bg-surface px-2 py-0.5 text-[10px] text-slate-600 ring-1 ring-line">
            {t('stage.adult')} → {fmt(adult.start, { day: 'numeric', month: 'short' })}
          </span>
        )}
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-slate-500" aria-hidden="true">
        {ticks.map((d) => (
          <span key={d}>{fmt(new Date(d).toISOString(), { weekday: 'short' })}</span>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-600" aria-hidden="true">
        <span className="inline-flex items-center gap-1">
          <span className="h-0.5 w-4 bg-[#0ea5e9]" /> {t('timing.humidityLine')}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" /> {t('timing.targetPin')}
        </span>
      </div>
    </div>
  );
}
