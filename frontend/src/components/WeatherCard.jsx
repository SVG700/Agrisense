import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, CloudRain, CloudSun, Droplets, Sun, Thermometer, Wind, X } from 'lucide-react';
import { api } from '../api.js';
import { EASE } from '../lib/motion.jsx';
import { timeAgo } from '../lib/pests.js';
import Badge from './Badge.jsx';
import { useT } from '../lib/i18n.jsx';

const REFRESH_MS = 15 * 60_000;
const CHECK_ICON = { rain: CloudRain, wind: Wind, daylight: Sun };

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function fmtWindow(w, t) {
  const start = new Date(w.start);
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const day =
    start.toDateString() === today.toDateString()
      ? t('weather.today')
      : start.toDateString() === tomorrow.toDateString()
        ? t('weather.tomorrow')
        : start.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day} ${fmtTime(w.start)}-${fmtTime(w.end)}`;
}

/**
 * "Can I spray now?" + next good window + whitefly degree-days, from
 * Open-Meteo via GET /api/weather. Purely advisory: when weather is
 * unavailable the card says so and nothing else changes.
 */
export default function WeatherCard({ deviceId, decision }) {
  const t = useT();
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .weather(deviceId)
        .then((d) => !cancelled && (setData(d), setFailed(false)))
        .catch(() => !cancelled && setFailed(true));
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [deviceId]);

  const title = (
    <h2 className="card-title">
      <span className="icon-chip h-8! w-8! rounded-lg!">
        <CloudSun className="h-4 w-4" />
      </span>
      {t('weather.title')}
    </h2>
  );

  if (failed || (data && !data.available)) {
    return (
      <section className="card flex flex-col gap-2" data-testid="weather-card">
        {title}
        <p className="text-sm text-slate-400">{data?.reason ?? 'Weather is unavailable right now.'} Pest decisions are not affected.</p>
      </section>
    );
  }
  if (!data) {
    return (
      <section className="card flex flex-col gap-3" data-testid="weather-card">
        {title}
        <div className="h-16 animate-pulse rounded-xl bg-slate-800/60" />
      </section>
    );
  }

  const s = data.spray;
  const c = data.current;
  const dd = data.degree_days;
  const sprayAdvised = decision?.decision === 'SPRAY';

  return (
    <section className="card card-hover flex flex-col gap-4" data-testid="weather-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        {title}
        <div className="flex flex-wrap gap-1.5">
          {data.stale && <Badge tone="warn">Stale forecast</Badge>}
          <Badge tone="muted" title={`${data.location.lat}, ${data.location.lon}`}>
            {data.location.default ? t('weather.defaultLocation') : data.location.label}
          </Badge>
        </div>
      </div>

      <motion.div
        key={String(s.can_spray_now)}
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: EASE }}
        className={`flex items-center gap-3 rounded-2xl p-3 ring-1 ${
          s.can_spray_now ? 'bg-emerald-500/10 ring-emerald-500/30' : 'bg-rose-500/10 ring-rose-500/30'
        }`}
      >
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${s.can_spray_now ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'}`}>
          {s.can_spray_now ? <Check className="h-6 w-6" /> : <X className="h-6 w-6" />}
        </span>
        <div className="min-w-0">
          <div className={`text-xl font-extrabold ${s.can_spray_now ? 'text-emerald-300' : 'text-rose-300'}`} data-testid="spray-verdict">
            {s.can_spray_now ? t('weather.yes') : t('weather.no')}
          </div>
          <div className="text-xs text-slate-400">
            {s.next_window
              ? s.can_spray_now
                ? t('weather.until', { t: fmtTime(s.next_window.end) })
                : t('weather.next', { w: fmtWindow(s.next_window, t) })
              : t('weather.none')}
          </div>
        </div>
      </motion.div>

      {sprayAdvised && (
        <p className="rounded-lg bg-slate-900/60 px-3 py-2 text-xs text-slate-300 ring-1 ring-slate-800" data-testid="spray-timing">
          {s.can_spray_now
            ? t('weather.adviseNow')
            : s.next_window
              ? t('weather.adviseWait', { w: fmtWindow(s.next_window, t) })
              : t('weather.adviseNone')}
        </p>
      )}

      <ul className="flex flex-col gap-1.5 text-sm">
        {s.checks.map((ch) => {
          const Icon = CHECK_ICON[ch.id] ?? Check;
          return (
            <li key={ch.id} className="flex items-start gap-2">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${ch.ok ? 'text-emerald-300' : 'text-rose-300'}`} />
              <span className={ch.ok ? 'text-slate-300' : 'text-rose-200'}>
                {t.lang === 'en' ? ch.label : t(`weather.${ch.id}${ch.ok ? 'Ok' : 'No'}`, { w: Math.round(c.wind_kmh ?? 0) })}
              </span>
            </li>
          );
        })}
        {s.cautions.map((msg) => (
          <li key={msg} className="flex items-start gap-2 text-amber-200">
            <Thermometer className="mt-0.5 h-4 w-4 shrink-0" /> {msg}
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <Mini icon={Thermometer} label={t('weather.now')} value={c.temperature != null ? `${Math.round(c.temperature)}°C` : '—'} />
        <Mini icon={Droplets} label={t('kpi.humidity')} value={c.humidity != null ? `${Math.round(c.humidity)}%` : '—'} />
        <Mini icon={Wind} label="Wind" value={c.wind_kmh != null ? `${Math.round(c.wind_kmh)} km/h` : '—'} />
      </div>

      {dd?.days_per_generation && (
        <div className="rounded-xl bg-slate-900/60 p-3 text-sm ring-1 ring-slate-800" data-testid="degree-days">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Next whitefly generation</div>
          <p className="text-slate-200">
            At about <b>{dd.per_day} degree-days/day</b>, one generation (≈{dd.generation_degree_days} DD above {dd.base_temp_c} °C) takes{' '}
            <b>~{dd.days_per_generation} days</b>: eggs laid today become adults around{' '}
            <b>{new Date(`${dd.next_adults_around}T00:00:00`).toLocaleDateString([], { day: 'numeric', month: 'short' })}</b>.
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            {dd.last_14_days} degree-days in the last 14 days. Development model and spray rules are placeholders, to confirm
            with the ICAR-IIHR mentor.
          </p>
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Open-Meteo forecast · updated {timeAgo(data.fetched_at)}
        {data.timezone ? ` · ${data.timezone}` : ''}
      </p>
    </section>
  );
}

function Mini({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg bg-slate-900/50 p-2 ring-1 ring-slate-800">
      <Icon className="mx-auto mb-0.5 h-3.5 w-3.5 text-slate-400" />
      <div className="font-semibold text-slate-100">{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}
