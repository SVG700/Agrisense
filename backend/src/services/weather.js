/**
 * Weather for spray timing and pest development, from Open-Meteo
 * (https://open-meteo.com - free, no API key).
 *
 *   sprayNow / nextWindow   "Can I spray now?": no rain expected in the next
 *                           6 h, wind in a safe range, daylight; otherwise the
 *                           next run of good hours (placeholder rules in
 *                           config/pests.json -> spray_window)
 *   degreeDays              whitefly development: degree-days per day from the
 *                           daily max/min, days to complete one generation and
 *                           when eggs laid today would become adults
 *                           (config/pests.json -> degree_days, placeholders)
 *
 * Never blocks anything: a short timeout, a 30-minute cache per location, the
 * last good forecast served (labelled stale) when Open-Meteo is unreachable,
 * and {available:false} otherwise. Decisions never depend on weather.
 */
import axios from 'axios';
import { DEGREE_DAY_CONFIG, SPRAY_CONFIG } from './pestConfig.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const HOURLY = 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,is_day';
const STALE_MAX_MS = 6 * 3_600_000;
const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Open-Meteo JSON -> hours [{t (ms), temp, rh, pop, rain, wind, gust, day}] + days [{t, tmax, tmin}]. */
export function parseForecast(data) {
  const h = data?.hourly;
  const d = data?.daily;
  if (!Array.isArray(h?.time) || !Array.isArray(d?.time)) throw new Error('unexpected Open-Meteo response');
  const hours = h.time.map((t, i) => ({
    t: t * 1000,
    temp: h.temperature_2m?.[i] ?? null,
    rh: h.relative_humidity_2m?.[i] ?? null,
    pop: h.precipitation_probability?.[i] ?? null,
    rain: h.precipitation?.[i] ?? null,
    wind: h.wind_speed_10m?.[i] ?? null,
    gust: h.wind_gusts_10m?.[i] ?? null,
    day: h.is_day?.[i] === 1,
  }));
  const days = d.time.map((t, i) => ({ t: t * 1000, tmax: d.temperature_2m_max?.[i] ?? null, tmin: d.temperature_2m_min?.[i] ?? null }));
  return { hours, days, timezone: data.timezone ?? null, utcOffsetSec: data.utc_offset_seconds ?? 0 };
}

/** Is hour i fit to spray? Rain is judged over the look-ahead that starts at that hour. */
export function hourCheck(hours, i, cfg = SPRAY_CONFIG) {
  const h = hours[i];
  const ahead = hours.slice(i, i + cfg.rainLookaheadHours);
  const maxPop = Math.max(0, ...ahead.map((x) => x.pop ?? 0));
  const rainMm = ahead.reduce((s, x) => s + (x.rain ?? 0), 0);
  const rainOk = maxPop < cfg.maxRainProbability && rainMm < cfg.maxRainMm;
  const windOk = h.wind != null && h.wind <= cfg.maxWindKmh && (h.gust == null || h.gust <= cfg.maxGustKmh);
  const dayOk = h.day;
  const checks = [
    {
      id: 'rain',
      ok: rainOk,
      label: rainOk
        ? `No rain expected in the next ${cfg.rainLookaheadHours} h (max ${maxPop}% chance)`
        : `Rain likely within ${cfg.rainLookaheadHours} h (${maxPop}% chance, ${round1(rainMm)} mm) - it would wash the spray off`,
    },
    {
      id: 'wind',
      ok: windOk,
      label: windOk
        ? `Wind ${round1(h.wind)} km/h - low drift`
        : `Wind ${round1(h.wind)} km/h${h.gust != null ? `, gusts ${round1(h.gust)}` : ''} - spray would drift (limit ${cfg.maxWindKmh} km/h)`,
    },
    { id: 'daylight', ok: dayOk, label: dayOk ? 'Daylight' : 'Dark - wait for daylight' },
  ];
  const cautions = [];
  if (h.temp != null && h.temp > cfg.maxTempC) cautions.push(`Hot (${round1(h.temp)} °C): droplets evaporate fast - early morning or evening is better.`);
  if (h.wind != null && h.wind < cfg.minWindKmh) cautions.push('Very still air: fine droplets can hang in the air - use coarse droplets.');
  return { ok: rainOk && windOk && dayOk, checks, cautions };
}

/** First run of >= minWindowHours good hours starting at or after index `from`. */
export function nextWindow(hours, from, cfg = SPRAY_CONFIG) {
  const end = Math.min(hours.length, from + cfg.searchHours);
  for (let i = from; i < end; i++) {
    if (!hourCheck(hours, i, cfg).ok) continue;
    let j = i;
    while (j + 1 < hours.length && hourCheck(hours, j + 1, cfg).ok) j++;
    if (j - i + 1 >= cfg.minWindowHours) {
      return { start: new Date(hours[i].t).toISOString(), end: new Date(hours[j].t + 3_600_000).toISOString(), hours: j - i + 1 };
    }
    i = j;
  }
  return null;
}

/** Index of the hour that contains `now`. */
const hourIndex = (hours, now) => Math.max(0, hours.findIndex((h) => h.t + 3_600_000 > now));

/** Daily degree-days with a horizontal upper cutoff. */
export function dailyDegreeDays(tmax, tmin, cfg = DEGREE_DAY_CONFIG) {
  if (tmax == null || tmin == null) return null;
  const mean = Math.min((tmax + tmin) / 2, cfg.upperTempC);
  return Math.max(0, mean - cfg.baseTempC);
}

/**
 * Development of the next generation: accumulates forecast degree-days from
 * today; beyond the forecast, continues at the recent average rate.
 */
export function degreeDays(days, now, cfg = DEGREE_DAY_CONFIG) {
  const dd = days.map((d) => ({ t: d.t, dd: dailyDegreeDays(d.tmax, d.tmin, cfg) })).filter((d) => d.dd != null);
  const todayIdx = dd.findIndex((d) => d.t + 86_400_000 > now);
  const past = (todayIdx < 0 ? dd : dd.slice(0, todayIdx)).slice(-14);
  const future = todayIdx < 0 ? [] : dd.slice(todayIdx);
  const recent = [...past.slice(-7), ...future];
  const rate = recent.length ? recent.reduce((s, d) => s + d.dd, 0) / recent.length : 0;

  let acc = 0;
  let daysNeeded = null;
  for (let k = 0; k < future.length; k++) {
    acc += future[k].dd;
    if (acc >= cfg.generationDegreeDays) {
      daysNeeded = k + 1;
      break;
    }
  }
  if (daysNeeded === null && rate > 0) daysNeeded = future.length + Math.ceil((cfg.generationDegreeDays - acc) / rate);
  const startT = future[0]?.t ?? now;
  return {
    pest: cfg.pest,
    base_temp_c: cfg.baseTempC,
    generation_degree_days: cfg.generationDegreeDays,
    per_day: round1(rate),
    last_14_days: round1(past.reduce((s, d) => s + d.dd, 0)),
    days_per_generation: daysNeeded,
    next_adults_around: daysNeeded ? new Date(startT + daysNeeded * 86_400_000).toISOString().slice(0, 10) : null,
    placeholder: true,
  };
}

/** Everything the dashboard shows, for one forecast and one moment. */
export function summarize(forecast, now = Date.now(), cfg = SPRAY_CONFIG) {
  const { hours, days } = forecast;
  const i = hourIndex(hours, now);
  const cur = hours[i];
  const check = hourCheck(hours, i, cfg);
  return {
    current: { time: new Date(cur.t).toISOString(), temperature: cur.temp, humidity: cur.rh, wind_kmh: cur.wind, gust_kmh: cur.gust, rain_probability: cur.pop, daylight: cur.day },
    spray: {
      can_spray_now: check.ok,
      checks: check.checks,
      cautions: check.cautions,
      next_window: check.ok ? nextWindow(hours, i, cfg) : nextWindow(hours, i + 1, cfg),
      rules: {
        rain_lookahead_hours: cfg.rainLookaheadHours,
        max_rain_probability: cfg.maxRainProbability,
        max_wind_kmh: cfg.maxWindKmh,
        min_window_hours: cfg.minWindowHours,
        placeholder: true,
      },
    },
    degree_days: degreeDays(days, now),
    next_24h: hours.slice(i, i + 24).map((h, k) => ({
      time: new Date(h.t).toISOString(),
      temp: h.temp,
      rain_probability: h.pop,
      wind_kmh: h.wind,
      ok: hourCheck(hours, i + k, cfg).ok,
    })),
  };
}

/**
 * @param {{config: object, http?: object, logger?: object}} deps
 */
const NOW_TTL_MS = 5 * 60_000; // Open-Meteo updates "current" every 15 min; 5 min keeps it fresh
const PLACE_TTL_MS = 24 * 3_600_000;
const GEOCODE_API = 'https://geocoding-api.open-meteo.com/v1/search';
const NOMINATIM = 'https://nominatim.openstreetmap.org';
const UA = 'AgriSense/1.0 (insect-monitoring hackathon project)';

/** Short "Village, District, State" label from an Open-Meteo / Nominatim result. */
function placeLabel(p) {
  const parts = [p.name, p.admin2 ?? p.admin3, p.admin1, p.country].filter(Boolean);
  return [...new Set(parts)].slice(0, 3).join(', ');
}

export function createWeather({ config, http = axios, logger }) {
  const w = config.weather;
  const cache = new Map(); // "lat,lon" -> {at, forecast}
  const nowCache = new Map(); // "lat,lon" -> {at, now}
  const placeCache = new Map(); // query -> {at, places}

  /** Live conditions at a point (Open-Meteo "current"). Never throws; null if unreachable. */
  async function currentAt(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = nowCache.get(key);
    if (hit && Date.now() - hit.at < NOW_TTL_MS) return { ...hit.now, cached: true };
    try {
      const { data } = await http.get(API, {
        timeout: w.timeoutMs,
        params: {
          latitude: lat,
          longitude: lon,
          current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day,precipitation',
          timezone: 'auto',
          wind_speed_unit: 'kmh',
        },
      });
      const c = data?.current;
      if (!c || typeof c.temperature_2m !== 'number') throw Object.assign(new Error('no current block'), { code: 'bad_response' });
      const now = {
        time: c.time,
        timezone: data.timezone ?? null,
        temperature: c.temperature_2m,
        humidity: c.relative_humidity_2m,
        feels_like: c.apparent_temperature,
        weather_code: c.weather_code,
        wind_kmh: c.wind_speed_10m,
        precipitation_mm: c.precipitation,
        is_day: c.is_day === 1,
        fetched_at: new Date().toISOString(),
      };
      nowCache.set(key, { at: Date.now(), now });
      if (nowCache.size > 300) nowCache.delete(nowCache.keys().next().value);
      return { ...now, cached: false };
    } catch (err) {
      logger?.warn('weather_now_failed', { code: err.code ?? err.response?.status ?? 'error' });
      if (hit) return { ...hit.now, cached: true, stale: true };
      return null;
    }
  }

  /** Place search: Open-Meteo for towns/villages, OpenStreetMap for street addresses. */
  async function searchPlaces(q) {
    const key = q.toLowerCase();
    const hit = placeCache.get(key);
    if (hit && Date.now() - hit.at < PLACE_TTL_MS) return hit.places;
    let places = [];
    try {
      const { data } = await http.get(GEOCODE_API, { timeout: w.timeoutMs, params: { name: q.split(',')[0].trim(), count: 6, language: 'en', format: 'json' } });
      places = (data?.results ?? []).map((p) => ({ label: placeLabel(p), lat: p.latitude, lon: p.longitude, source: 'open-meteo' }));
    } catch (err) {
      logger?.warn('geocode_failed', { code: err.code ?? err.response?.status ?? 'error' });
    }
    // Full addresses ("12 MG Road, Bengaluru") or no match: ask OpenStreetMap
    if (!places.length || /\d|,/.test(q)) {
      try {
        const { data } = await http.get(`${NOMINATIM}/search`, {
          timeout: w.timeoutMs,
          headers: { 'User-Agent': UA },
          params: { q, format: 'jsonv2', limit: 6, addressdetails: 0 },
        });
        const osm = (Array.isArray(data) ? data : []).map((p) => ({ label: p.display_name.split(', ').slice(0, 4).join(', '), lat: Number(p.lat), lon: Number(p.lon), source: 'openstreetmap' }));
        places = [...osm, ...places].slice(0, 6);
      } catch (err) {
        logger?.warn('geocode_osm_failed', { code: err.code ?? err.response?.status ?? 'error' });
      }
    }
    placeCache.set(key, { at: Date.now(), places });
    if (placeCache.size > 300) placeCache.delete(placeCache.keys().next().value);
    return places;
  }

  /** Name for a point (for "Use my location"); falls back to the coordinates. */
  async function placeName(lat, lon) {
    const key = `rev:${lat.toFixed(3)},${lon.toFixed(3)}`;
    const hit = placeCache.get(key);
    if (hit && Date.now() - hit.at < PLACE_TTL_MS) return hit.places;
    let label = `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    try {
      const { data } = await http.get(`${NOMINATIM}/reverse`, { timeout: w.timeoutMs, headers: { 'User-Agent': UA }, params: { lat, lon, format: 'jsonv2', zoom: 14 } });
      const a = data?.address ?? {};
      const parts = [a.village ?? a.suburb ?? a.town ?? a.city_district ?? a.hamlet, a.city ?? a.county ?? a.state_district, a.state].filter(Boolean);
      if (parts.length) label = [...new Set(parts)].join(', ');
    } catch (err) {
      logger?.warn('reverse_geocode_failed', { code: err.code ?? err.response?.status ?? 'error' });
    }
    placeCache.set(key, { at: Date.now(), places: label });
    return label;
  }

  async function forecastFor(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < w.cacheMs) return { forecast: hit.forecast, at: hit.at, cached: true, stale: false };
    try {
      const { data } = await http.get(API, {
        timeout: w.timeoutMs,
        params: {
          latitude: lat,
          longitude: lon,
          hourly: HOURLY,
          daily: 'temperature_2m_max,temperature_2m_min',
          past_days: 14,
          forecast_days: 7,
          timezone: 'auto',
          timeformat: 'unixtime',
          wind_speed_unit: 'kmh',
        },
      });
      const forecast = parseForecast(data);
      const at = Date.now();
      cache.set(key, { at, forecast });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return { forecast, at, cached: false, stale: false };
    } catch (err) {
      logger?.warn('weather_failed', { code: err.code ?? err.response?.status ?? 'error' });
      if (hit && Date.now() - hit.at < STALE_MAX_MS) return { forecast: hit.forecast, at: hit.at, cached: true, stale: true };
      return null;
    }
  }

  return {
    describe: () => ({ state: w.enabled ? 'configured' : 'disabled', provider: w.enabled ? 'open-meteo' : null }),

    /** The parsed hourly forecast (14 past + 7 next days) for the lifecycle model, or null. */
    async forecast({ lat, lon }) {
      if (!w.enabled) return null;
      const got = await forecastFor(lat, lon);
      return got ? { ...got.forecast, fetched_at: new Date(got.at).toISOString(), stale: got.stale } : null;
    },

    /** Live temperature / humidity at a point. Never throws. */
    async now({ lat, lon, label }) {
      const base = { source: 'open-meteo', location: { lat, lon, label } };
      if (!w.enabled) return { ...base, available: false, reason: 'Weather is turned off (WEATHER_ENABLED=false).' };
      const c = await currentAt(lat, lon);
      return c ? { ...base, available: true, ...c } : { ...base, available: false, reason: 'Live weather unreachable right now.' };
    },

    searchPlaces,
    placeName,

    /** Never throws. */
    async forLocation({ lat, lon, label, default: isDefault = false }) {
      const base = { source: 'open-meteo', location: { lat, lon, label, default: isDefault } };
      if (!w.enabled) return { ...base, available: false, reason: 'Weather is turned off (WEATHER_ENABLED=false).' };
      const got = await forecastFor(lat, lon);
      if (!got) return { ...base, available: false, reason: 'Weather service unreachable right now - pest decisions are not affected.' };
      try {
        return { ...base, available: true, fetched_at: new Date(got.at).toISOString(), cached: got.cached, stale: got.stale, timezone: got.forecast.timezone, ...summarize(got.forecast) };
      } catch (err) {
        logger?.warn('weather_summary_failed', { error: err.message });
        return { ...base, available: false, reason: 'Weather data could not be read.' };
      }
    },
  };
}
