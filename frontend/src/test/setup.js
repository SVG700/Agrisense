import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Recharts' ResponsiveContainer needs ResizeObserver, which jsdom lacks
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};

// Tests run with prefers-reduced-motion: reduce, so animated values (counters,
// entrances) render their final state immediately - this also covers the
// accessibility path where animations are disabled.
window.matchMedia ??= (query) => ({
  matches: query.includes('prefers-reduced-motion: reduce') || query === '(prefers-reduced-motion)',
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
});
