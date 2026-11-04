/**
 * The place the dashboard shows live weather for, shared by every component and
 * remembered on this device. null = the farm's default location (backend config).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { api } from '../api.js';

const KEY = 'agrisense.place';
const REFRESH_MS = 5 * 60_000;
const listeners = new Set();

let place = (() => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? p : null;
  } catch {
    return null;
  }
})();

export function setPlace(next) {
  place = next;
  try {
    next ? localStorage.setItem(KEY, JSON.stringify(next)) : localStorage.removeItem(KEY);
  } catch {
    /* not remembered */
  }
  for (const l of listeners) l();
}

export function usePlace() {
  const p = useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    () => place,
    () => place
  );
  return [p, setPlace];
}

/**
 * Live temperature / humidity at the chosen place (Open-Meteo via the backend).
 * Refreshes every 5 minutes, when the tab becomes visible again, and on place change.
 */
export function useLiveWeather() {
  const [p] = usePlace();
  const [state, setState] = useState({ data: null, loading: true });
  useEffect(() => {
    let off = false;
    const load = () => {
      setState((s) => ({ ...s, loading: true }));
      api
        .weatherNow(p)
        .then((data) => !off && setState({ data, loading: false }))
        .catch(() => !off && setState((s) => ({ data: s.data, loading: false })));
    };
    load();
    const t = setInterval(load, REFRESH_MS);
    const onVis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [p?.lat, p?.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, place: p };
}
