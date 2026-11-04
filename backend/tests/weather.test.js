/**
 * Weather: Open-Meteo parsing, "Can I spray now?", next good window,
 * whitefly degree-days, caching, stale fallback and never blocking.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { createWeather, dailyDegreeDays, degreeDays, hourCheck, nextWindow, parseForecast, summarize } from '../src/services/weather.js';
import { DEVICE, startApp } from './helpers.js';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-04T00:30:00Z'); // 06:00 IST

/**
 * Builds an Open-Meteo-shaped response: 48 hourly points from T0 with a
 * per-hour override function, and 21 daily points (14 past + 7 ahead).
 */
function openMeteo(hourFn = () => ({}), { tmax = 30, tmin = 20 } = {}) {
  const n = 48;
  const hourly = { time: [], temperature_2m: [], relative_humidity_2m: [], precipitation_probability: [], precipitation: [], wind_speed_10m: [], wind_gusts_10m: [], is_day: [] };
  for (let k = 0; k < n; k++) {
    const localHour = (6 + k) % 24;
    const v = { temp: 26, rh: 70, pop: 5, rain: 0, wind: 8, gust: 14, day: localHour >= 6 && localHour < 18 ? 1 : 0, ...hourFn(k) };
    hourly.time.push((T0 + k * HOUR) / 1000);
    hourly.temperature_2m.push(v.temp);
    hourly.relative_humidity_2m.push(v.rh);
    hourly.precipitation_probability.push(v.pop);
    hourly.precipitation.push(v.rain);
    hourly.wind_speed_10m.push(v.wind);
    hourly.wind_gusts_10m.push(v.gust);
    hourly.is_day.push(v.day);
  }
  const day0 = Date.parse('2026-11-03T18:30:00Z'); // 4 Nov 00:00 IST
  const daily = { time: [], temperature_2m_max: [], temperature_2m_min: [] };
  for (let k = -14; k < 7; k++) {
    daily.time.push((day0 + k * 86_400_000) / 1000);
    daily.temperature_2m_max.push(tmax);
    daily.temperature_2m_min.push(tmin);
  }
  return { timezone: 'Asia/Kolkata', utc_offset_seconds: 19800, hourly, daily };
}

describe('spray conditions', () => {
  test('good morning: can spray now', () => {
    const s = summarize(parseForecast(openMeteo()), T0 + 60_000);
    assert.equal(s.spray.can_spray_now, true);
    assert.deepEqual(s.spray.checks.map((c) => c.ok), [true, true, true]);
    assert.ok(s.spray.next_window.hours >= 2);
  });

  test('rain within 6 h blocks spraying; next window starts after it', () => {
    // rain at hours 3-5 (09:00-11:00 IST): blocked from 00:30Z until the 6 h look-ahead clears it
    const f = parseForecast(openMeteo((k) => (k >= 3 && k <= 5 ? { pop: 80, rain: 2 } : {})));
    const now = summarize(f, T0 + 60_000);
    assert.equal(now.spray.can_spray_now, false);
    assert.match(now.spray.checks[0].label, /Rain likely within 6 h \(80% chance/);
    assert.equal(now.spray.next_window.start, new Date(T0 + 6 * HOUR).toISOString()); // 12:00 IST
  });

  test('wind and darkness each block; cautions for heat and still air', () => {
    const f = parseForecast(openMeteo((k) => (k === 0 ? { wind: 22, gust: 35 } : k === 1 ? { temp: 35, wind: 1 } : {})));
    const windy = hourCheck(f.hours, 0);
    assert.equal(windy.ok, false);
    assert.match(windy.checks[1].label, /drift/);
    const hot = hourCheck(f.hours, 1);
    assert.equal(hot.ok, true);
    assert.equal(hot.cautions.length, 2);
    const night = hourCheck(f.hours, 14); // 20:00 IST
    assert.equal(night.ok, false);
    assert.equal(night.checks[2].label, 'Dark - wait for daylight');
  });

  test('no window when every hour fails', () => {
    const f = parseForecast(openMeteo(() => ({ pop: 90, rain: 5 })));
    assert.equal(nextWindow(f.hours, 0), null);
  });
});

describe('degree-days', () => {
  test('daily degree-days use base 10 °C with an upper cutoff', () => {
    assert.equal(dailyDegreeDays(30, 20), 15);
    assert.equal(dailyDegreeDays(12, 4), 0);
    assert.equal(dailyDegreeDays(40, 30), 22); // mean 35 capped at 32
  });

  test('15 DD/day -> a 300 DD generation takes 20 days', () => {
    const d = degreeDays(parseForecast(openMeteo()).days, T0);
    assert.equal(d.per_day, 15);
    assert.equal(d.days_per_generation, 20);
    assert.equal(d.last_14_days, 210);
    assert.equal(d.next_adults_around, '2026-11-23'); // 4 Nov + 20 days (local-day timestamps)
    assert.equal(d.placeholder, true);
  });

  test('cooler weather -> slower development', () => {
    const d = degreeDays(parseForecast(openMeteo(undefined, { tmax: 24, tmin: 16 })).days, T0);
    assert.equal(d.days_per_generation, 30); // 10 DD/day
  });
});

describe('weather service', () => {
  const config = loadConfig({}).config;

  test('caches per location; serves stale data (labelled) when Open-Meteo fails; never throws', async () => {
    let fail = false;
    const http = { calls: 0, get: async () => { http.calls++; if (fail) throw Object.assign(new Error('down'), { code: 'ECONNRESET' }); return { data: openMeteo() }; } };
    const w = createWeather({ config: { ...config, weather: { ...config.weather, cacheMs: 0 } }, http });
    const a = await w.forLocation({ lat: 13.1352, lon: 77.4846, label: 'x' });
    assert.equal(a.available, true);
    assert.equal(a.stale, false);
    fail = true;
    const b = await w.forLocation({ lat: 13.1352, lon: 77.4846, label: 'x' });
    assert.equal(b.available, true);
    assert.equal(b.stale, true);
    const c = await w.forLocation({ lat: 12, lon: 76, label: 'other' });
    assert.equal(c.available, false);
    assert.match(c.reason, /not affected/);

    const http2 = { calls: 0, get: async () => { http2.calls++; return { data: openMeteo() }; } };
    const w2 = createWeather({ config, http: http2 });
    await w2.forLocation({ lat: 13.13, lon: 77.48 });
    const again = await w2.forLocation({ lat: 13.1301, lon: 77.4799 }); // same 2-decimal cell
    assert.equal(http2.calls, 1);
    assert.equal(again.cached, true);
  });

  test('Open-Meteo request: free endpoint, no key, short timeout', async () => {
    let seen;
    const w = createWeather({ config, http: { get: async (url, opts) => ((seen = { url, opts }), { data: openMeteo() }) } });
    await w.forLocation({ lat: 13.1, lon: 77.5 });
    assert.equal(seen.url, 'https://api.open-meteo.com/v1/forecast');
    assert.equal(seen.opts.timeout, 4000);
    assert.equal(seen.opts.params.timezone, 'auto');
    assert.ok(!JSON.stringify(seen).match(/key/i));
  });
});

describe('GET /api/weather', () => {
  test('uses the trap location, else the IIHR default; offline -> 200 with available:false', async () => {
    let asked;
    const app = await startApp({ weatherHttp: { get: async (url, opts) => ((asked = opts.params), { data: openMeteo() }) } });
    try {
      const res = await app.request('GET', `/api/weather?device_id=${DEVICE}`);
      assert.equal(res.status, 200);
      assert.equal(res.body.location.default, true); // demo device has no coordinates
      assert.equal(asked.latitude, 13.1352);
      assert.equal(typeof res.body.spray.can_spray_now, 'boolean');
      assert.equal(res.body.degree_days.generation_degree_days, 300);
      assert.equal((await app.request('GET', '/api/weather?lat=95&lon=1')).status, 400);
      const point = await app.request('GET', '/api/weather?lat=12.97&lon=77.59');
      assert.equal(point.body.location.label, 'Selected location');
    } finally {
      await app.close();
    }
    const offline = await startApp();
    try {
      const res = await offline.request('GET', '/api/weather');
      assert.equal(res.status, 200);
      assert.equal(res.body.available, false);
      assert.equal((await offline.request('GET', '/api/health')).body.services.weather.provider, 'open-meteo');
    } finally {
      await offline.close();
    }
  });
});

describe('live conditions and place search', () => {
  const fakeHttp = () => {
    const calls = [];
    return {
      calls,
      get: async (url, opts) => {
        calls.push({ url, params: opts?.params });
        if (url.includes('geocoding-api')) return { data: { results: [{ name: 'Hesaraghatta', admin2: 'Bengaluru Urban', admin1: 'Karnataka', country: 'India', latitude: 13.14, longitude: 77.48 }] } };
        if (url.includes('nominatim') && url.endsWith('/reverse')) return { data: { address: { suburb: 'Ashokanagar', city: 'Bengaluru', state: 'Karnataka' } } };
        if (url.includes('nominatim')) return { data: [{ display_name: '12, MG Road, Ashok Nagar, Bengaluru, Karnataka, India', lat: '12.97', lon: '77.60' }] };
        if (opts?.params?.current) return { data: { timezone: 'Asia/Kolkata', current: { time: '2026-11-04T16:30', temperature_2m: 24.6, relative_humidity_2m: 77, apparent_temperature: 27.1, weather_code: 53, wind_speed_10m: 11, is_day: 1, precipitation: 0.2 } } };
        throw new Error('unexpected');
      },
    };
  };

  test('GET /api/weather/now returns live temperature and humidity, cached for 5 minutes', async () => {
    const http = fakeHttp();
    const app = await startApp({ weatherHttp: http });
    try {
      const r = await app.request('GET', '/api/weather/now?lat=13.1352&lon=77.4846&label=Hesaraghatta');
      assert.equal(r.status, 200);
      assert.equal(r.body.available, true);
      assert.equal(r.body.temperature, 24.6);
      assert.equal(r.body.humidity, 77);
      assert.equal(r.body.location.label, 'Hesaraghatta');
      const again = await app.request('GET', '/api/weather/now?lat=13.1352&lon=77.4846');
      assert.equal(again.body.cached, true);
      assert.equal(http.calls.filter((c) => c.params?.current).length, 1);
      assert.equal((await app.request('GET', '/api/weather/now?lat=200&lon=1')).status, 400);
    } finally {
      await app.close();
    }
  });

  test('places: villages via Open-Meteo, street addresses via OpenStreetMap, reverse lookup', async () => {
    const app = await startApp({ weatherHttp: fakeHttp() });
    try {
      const village = (await app.request('GET', '/api/places?q=Hesaraghatta')).body;
      assert.equal(village[0].label, 'Hesaraghatta, Bengaluru Urban, Karnataka');
      const street = (await app.request('GET', '/api/places?q=12 MG Road, Bengaluru')).body;
      assert.equal(street[0].source, 'openstreetmap');
      assert.match(street[0].label, /MG Road/);
      const rev = (await app.request('GET', '/api/places/reverse?lat=12.97&lon=77.59')).body;
      assert.equal(rev.label, 'Ashokanagar, Bengaluru, Karnataka');
      assert.equal((await app.request('GET', '/api/places?q=x')).status, 400);
    } finally {
      await app.close();
    }
  });

  test('when the weather service is down, live conditions say so (no crash)', async () => {
    const app = await startApp();
    try {
      const r = await app.request('GET', '/api/weather/now?lat=13&lon=77');
      assert.equal(r.status, 200);
      assert.equal(r.body.available, false);
    } finally {
      await app.close();
    }
  });
});
