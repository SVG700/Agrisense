import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarDays, Cloud, CloudDrizzle, CloudFog, CloudLightning, CloudRain, CloudSnow, CloudSun, Droplets, SprayCan, Sun, Wind } from 'lucide-react';
import { api } from '../api.js';
import { usePlace } from '../lib/place.js';
import LocationPicker from './LocationPicker.jsx';
import { useT } from '../lib/i18n.jsx';

const ICONS = { sun: Sun, 'cloud-sun': CloudSun, cloud: Cloud, fog: CloudFog, drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning };
const ICON_TONE = { sun: 'text-amber-500', 'cloud-sun': 'text-amber-500', drizzle: 'text-sky-500', rain: 'text-sky-600', storm: 'text-violet-500' };
const REFRESH_MS = 30 * 60_000;

/**
 * The next 7 days at the chosen place (same place as Trap Health): weather,
 * temperature range on one shared scale, humidity, rain, wind and how many
 * hours each day are good for spraying.
 */
export default function ForecastCard() {
  const t = useT();
  const [place] = usePlace();
  const [data, setData] = useState(null);

  useEffect(() => {
    let off = false;
    const load = () =>
      api
        .weatherAt(place)
        .then((d) => !off && setData(d))
        .catch(() => !off && setData({ available: false, reason: t('forecast.down') }));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      off = true;
      clearInterval(id);
    };
  }, [place?.lat, place?.lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const days = data?.available ? data.daily ?? [] : [];
  const tz = data?.timezone || 'Asia/Kolkata';
  const lo = Math.min(...days.map((d) => d.temp_min ?? 99));
  const hi = Math.max(...days.map((d) => d.temp_max ?? -99));
  const span = Math.max(1, hi - lo);
  const best = days.reduce((b, d) => (d.spray_hours > (b?.spray_hours ?? 0) ? d : b), null);
  const dayName = (iso, i) => (i === 0 ? t('forecast.today') : new Intl.DateTimeFormat('en-IN', { timeZone: tz, weekday: 'short' }).format(new Date(iso)));
  const dayDate = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short' }).format(new Date(iso));
  const hourOf = (iso) => new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: 'numeric', hour12: true }).format(new Date(iso)).toUpperCase();

  return (
    <section className="card p-0!" aria-labelledby="forecast-title" data-testid="forecast-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 id="forecast-title" className="card-title">
            <span className="icon-chip h-8! w-8! rounded-lg!">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
            </span>
            {t('forecast.title')}
          </h2>
          <div className="mt-1.5">
            <LocationPicker label={data?.location?.label ?? place?.label} />
          </div>
        </div>
        {best && (
          <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-200">
            <SprayCan className="h-3.5 w-3.5" aria-hidden="true" />
            {t('forecast.best', { day: dayName(best.date, days.indexOf(best)), hour: hourOf(best.first_spray_hour) })}
          </p>
        )}
      </div>

      <div className="p-5">
        {!data ? (
          <div className="h-48 animate-pulse rounded-2xl bg-slate-100" />
        ) : !data.available ? (
          <p className="rounded-2xl bg-slate-50 p-5 text-sm text-slate-600 ring-1 ring-line">{data.reason}</p>
        ) : (
          <ol className="snap-rail -mx-1 grid auto-cols-[minmax(118px,1fr)] grid-flow-col gap-2 overflow-x-auto px-1 pb-1" aria-label={t('forecast.title')}>
            {days.map((d, i) => {
              const Icon = ICONS[d.icon] ?? Cloud;
              const left = (((d.temp_min ?? lo) - lo) / span) * 100;
              const width = (((d.temp_max ?? hi) - (d.temp_min ?? lo)) / span) * 100;
              return (
                <motion.li
                  key={d.date}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 28, delay: i * 0.04 }}
                  className={`flex flex-col gap-2 rounded-2xl p-3 ring-1 ${i === 0 ? 'bg-butter-soft ring-[#f0d77a]' : 'bg-slate-50 ring-line'}`}
                >
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-sm font-semibold text-ink">{dayName(d.date, i)}</span>
                    <span className="text-[11px] text-slate-500">{dayDate(d.date)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon className={`h-7 w-7 shrink-0 ${ICON_TONE[d.icon] ?? 'text-slate-500'}`} aria-hidden="true" />
                    <span className="text-xs leading-tight text-slate-600">{d.weather}</span>
                  </div>
                  <div>
                    <div className="flex justify-between text-sm tabular-nums">
                      <span className="text-slate-500">{Math.round(d.temp_min)}°</span>
                      <span className="font-semibold text-ink">{Math.round(d.temp_max)}°</span>
                    </div>
                    {/* this day's range on the week's scale */}
                    <div className="mt-1 h-1.5 rounded-full bg-slate-200" aria-hidden="true">
                      <div className="h-full rounded-full bg-gradient-to-r from-sky-400 via-amber-400 to-orange-500" style={{ marginLeft: `${left}%`, width: `${Math.max(6, width)}%` }} />
                    </div>
                  </div>
                  <dl className="grid gap-1 text-[11px] text-slate-600">
                    <div className="flex items-center gap-1.5" title={t('kpi.humidity')}>
                      <Droplets className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
                      <dt className="sr-only">{t('kpi.humidity')}</dt>
                      <dd>{d.humidity != null ? `${d.humidity}%` : '—'}</dd>
                    </div>
                    <div className="flex items-center gap-1.5" title={t('forecast.rain')}>
                      <CloudRain className="h-3.5 w-3.5 text-sky-600" aria-hidden="true" />
                      <dt className="sr-only">{t('forecast.rain')}</dt>
                      <dd>
                        {d.rain_probability != null ? `${d.rain_probability}%` : '—'}
                        {d.rain_mm ? ` · ${d.rain_mm} mm` : ''}
                      </dd>
                    </div>
                    <div className="flex items-center gap-1.5" title={t('forecast.wind')}>
                      <Wind className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
                      <dt className="sr-only">{t('forecast.wind')}</dt>
                      <dd>{d.wind_max_kmh != null ? `${Math.round(d.wind_max_kmh)} km/h` : '—'}</dd>
                    </div>
                  </dl>
                  <span
                    className={`mt-auto rounded-full px-2 py-1 text-center text-[11px] font-medium ${d.spray_hours ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}
                    title={d.first_spray_hour ? t('forecast.fromHour', { hour: hourOf(d.first_spray_hour) }) : undefined}
                  >
                    {d.spray_hours ? t('forecast.sprayHours', { n: d.spray_hours }) : t('forecast.noSpray')}
                  </span>
                </motion.li>
              );
            })}
          </ol>
        )}
        {data?.available && <p className="mt-3 text-[11px] text-slate-500">{t('forecast.note')}</p>}
      </div>
    </section>
  );
}
