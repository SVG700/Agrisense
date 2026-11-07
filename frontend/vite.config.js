import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * AGRISENSE_BASE_URL: the one address all API calls use (`${AGRISENSE_BASE_URL}/api/...`).
 * Comes from the AGRISENSE_BASE_URL environment variable / frontend/.env when set, else from the
 * repo-root agrisense.json. Read once when Vite starts, so restart `npm run dev` after changing it.
 */
function agrisenseBaseUrl(mode) {
  const fromEnv = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'AGRISENSE_').AGRISENSE_BASE_URL;
  let value = fromEnv;
  if (!value) {
    const file = new URL('../agrisense.json', import.meta.url);
    try {
      value = JSON.parse(readFileSync(file, 'utf8')).AGRISENSE_BASE_URL;
    } catch (err) {
      throw new Error(`AGRISENSE_BASE_URL is not set and ${fileURLToPath(file)} could not be read: ${err.message}`);
    }
  }
  const url = String(value ?? '').trim().replace(/\/+$/, '').replace(/\/api$/i, '');
  if (!/^https?:\/\/[^/]+$/.test(url)) throw new Error(`AGRISENSE_BASE_URL must look like http://<ip>:<port> (got "${value}")`);
  return url;
}

/**
 * Content-Security-Policy for the BUILT dashboard (`vite preview` here; static
 * hosts use public/_headers). Not applied to `vite dev`, which needs inline scripts.
 * img-src allows https: for Supabase signed URLs; the AgriSense host is added so the API can be reached.
 */
const csp = (extra = '') =>
  [
    "default-src 'self'",
    // kepler.gl compiles a WebAssembly module; 'wasm-unsafe-eval' allows that but NOT JS eval()
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:${extra}`,
    `connect-src 'self' https:${extra}`,
    "font-src 'self'",
    // MapLibre / deck.gl (map page) run web workers from blob: URLs
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

export default defineConfig(({ mode }) => {
  const base = agrisenseBaseUrl(mode);
  return {
  plugins: [react(), tailwindcss()],
  // api.js reads this via lib/baseUrl.js
  define: { __AGRISENSE_BASE_URL__: JSON.stringify(base) },
  resolve: {
    // kepler.gl imports Node's `assert`; Vite stubs Node built-ins in the browser (see src/map/shims/assert.js)
    alias: [{ find: /^assert$/, replacement: fileURLToPath(new URL('./src/map/shims/assert.js', import.meta.url)) }],
  },
  preview: {
    port: 4173,
    headers: {
      'Content-Security-Policy': csp(` ${base}`),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
  server: {
    port: 5173,
    // No /api proxy: the browser calls AGRISENSE_BASE_URL directly (the host proxies /api to its backend)
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
  },
  };
});
