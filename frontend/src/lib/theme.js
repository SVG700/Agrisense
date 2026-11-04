/**
 * Theme (dark / light / auto) and per-viewer dashboard preferences.
 * Both live in localStorage and are wrapped in try/catch: in private mode the
 * choice simply isn't remembered.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const THEME_KEY = 'agrisense.theme';
const LAYOUT_KEY = 'agrisense.layout';
export const THEMES = ['dark', 'light', 'auto'];

const read = (key, fallback) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not remembered */
  }
};

let fadeTimer = null;
const systemDark = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true);

/** Applies the chosen theme to <html data-theme> and follows the OS in "auto". */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const t = read(THEME_KEY, 'light');
    return THEMES.includes(t) ? t : 'light';
  });
  const [resolved, setResolved] = useState(() => (theme === 'auto' ? (systemDark() ? 'dark' : 'light') : theme));

  const first = useRef(true);
  useEffect(() => {
    const apply = () => {
      const r = theme === 'auto' ? (systemDark() ? 'dark' : 'light') : theme;
      setResolved(r);
      const html = document.documentElement;
      // Fade colours on a real switch (not on first paint); the class lives ~0.5 s only
      if (!first.current && html.dataset.theme !== r && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        html.classList.add('theme-fade');
        clearTimeout(fadeTimer);
        fadeTimer = setTimeout(() => html.classList.remove('theme-fade'), 520);
      }
      first.current = false;
      html.dataset.theme = r;
    };
    apply();
    if (theme !== 'auto' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [theme]);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    write(THEME_KEY, t);
  }, []);
  return { theme, resolved, setTheme };
}

/** Dashboard sections the viewer can reorder and hide (Customize). */
export const SECTIONS = [
  { id: 'glance', label: 'Today at a glance' },
  { id: 'timeline', label: 'Daily timeline' },
  { id: 'detections', label: 'Live detections & AI advisor' },
  { id: 'traps', label: 'All traps & impact' },
  { id: 'log', label: 'Action log & recent captures' },
  { id: 'whatif', label: 'What-if simulator' },
  { id: 'climate', label: 'Microclimate chart' },
];
const DEFAULT_LAYOUT = { order: SECTIONS.map((s) => s.id), hidden: [] };

export function useLayout() {
  const [layout, setLayoutState] = useState(() => {
    const l = read(LAYOUT_KEY, DEFAULT_LAYOUT);
    // Keep only known ids, and add sections introduced since the layout was saved
    const known = SECTIONS.map((s) => s.id);
    const order = [...(Array.isArray(l?.order) ? l.order.filter((id) => known.includes(id)) : [])];
    for (const id of known) if (!order.includes(id)) order.push(id);
    return { order, hidden: Array.isArray(l?.hidden) ? l.hidden.filter((id) => known.includes(id)) : [] };
  });
  const setLayout = useCallback((next) => {
    setLayoutState(next);
    write(LAYOUT_KEY, next);
  }, []);
  const reset = useCallback(() => setLayout(DEFAULT_LAYOUT), [setLayout]);
  return { layout, setLayout, reset };
}

/** A short tap of haptic feedback where the device supports it (Android browsers). */
export function haptic(ms = 8) {
  try {
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) navigator.vibrate?.(ms);
  } catch {
    /* unsupported */
  }
}

