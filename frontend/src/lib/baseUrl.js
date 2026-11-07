/**
 * The AgriSense address every API call uses: `${AGRISENSE_BASE_URL}/api/<endpoint>`.
 *
 * Set in ONE place: the repo-root agrisense.json (or an AGRISENSE_BASE_URL environment
 * variable when starting Vite). vite.config.js reads it and injects it as
 * __AGRISENSE_BASE_URL__ at dev-server start / build time, so restart `npm run dev`
 * after changing it.
 */

/** "http://host:5173/" or "http://host:5173/api" -> "http://host:5173" (no doubled /api, no trailing slash). */
export function normalizeBaseUrl(value) {
  return String(value ?? '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/api$/i, '');
}

// eslint-disable-next-line no-undef
export const AGRISENSE_BASE_URL = normalizeBaseUrl(typeof __AGRISENSE_BASE_URL__ === 'undefined' ? '' : __AGRISENSE_BASE_URL__);
