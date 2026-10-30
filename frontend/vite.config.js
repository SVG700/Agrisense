import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Content-Security-Policy for the BUILT dashboard (`vite preview` here; static
 * hosts use public/_headers). Not applied to `vite dev`, which needs inline scripts.
 * img-src allows https: for Supabase signed URLs; localhost is added for local previews.
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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    // kepler.gl imports Node's `assert`; Vite stubs Node built-ins in the browser (see src/map/shims/assert.js)
    alias: [{ find: /^assert$/, replacement: fileURLToPath(new URL('./src/map/shims/assert.js', import.meta.url)) }],
  },
  preview: {
    port: 4173,
    headers: {
      'Content-Security-Policy': csp(' http://localhost:* http://127.0.0.1:*'),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  },
  server: {
    port: 5173,
    // Proxy API calls in dev so the browser never deals with CORS
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
  },
});
