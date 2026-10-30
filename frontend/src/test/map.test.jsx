/**
 * Pest Surveillance Map: config builder + page behaviour (offline fallback,
 * simulated badge, trap list). kepler.gl itself is never loaded here: the page
 * only imports it after the basemap probe succeeds, and the probe is mocked.
 */
import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import PestMapPage from '../map/PestMapPage.jsx';
import {
  DATASET_ID,
  DECISION_COLORS,
  DEFAULT_STYLE_URL,
  buildCustomMapStyles,
  buildMapConfig,
  dateDomain,
  toKeplerDataset,
} from '../map/keplerConfig.js';

const row = (over = {}) => ({
  trap_id: 't1',
  trap_name: 'SIM · Malur tomato',
  latitude: 13.0156,
  longitude: 77.9264,
  date: '2026-10-17',
  pest_count: 55,
  predator_count: 2,
  decision: 'SPRAY',
  dominant_pest: 'whitefly',
  simulated: true,
  ...over,
});

const ROWS = [
  row(),
  row({ trap_id: 't2', trap_name: 'SIM · Kolar tomato', decision: 'WAIT', pest_count: 4, predator_count: 0 }),
  row({ date: '2026-10-18', pest_count: 60, predator_count: 20, decision: 'BIOCONTROL' }),
];

const META = { simulated: true, trap_count: 2, row_count: 3, warnings: [] };

const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });

describe('kepler config', () => {
  test('dataset sends dates as noon UTC timestamps in field order', () => {
    const ds = toKeplerDataset(ROWS);
    expect(ds.info.id).toBe(DATASET_ID);
    expect(ds.data.fields.map((f) => f.name)).toContain('date');
    expect(ds.data.rows[0][4]).toBe('2026-10-17 12:00:00');
    expect(ds.data.rows[0]).toHaveLength(ds.data.fields.length);
  });

  test('default view: decision colours, pest-count size, one-day time window', () => {
    const cfg = buildMapConfig(ROWS).config.visState;
    const layer = cfg.layers[0];
    expect(layer.visualChannels.colorField.name).toBe('decision');
    expect(layer.visualChannels.sizeField.name).toBe('pest_count');
    expect(Object.fromEntries(layer.config.visConfig.colorRange.colorMap)).toEqual(DECISION_COLORS);
    const [start, end] = cfg.filters[0].value;
    expect(cfg.filters[0].name).toEqual(['date']);
    expect(start).toBe(dateDomain(ROWS)[0]);
    expect(end - start + 1).toBe(86_400_000); // exactly 24 h, so playback always shows one day
    expect(new Date(start).toISOString()).toBe('2026-10-17T12:00:00.000Z');
  });

  test('no rows -> no time filter', () => {
    expect(buildMapConfig([]).config.visState.filters).toEqual([]);
  });

  test('satellite style only with a Mapbox token', () => {
    expect(buildCustomMapStyles('')).toEqual([]);
    expect(buildCustomMapStyles(undefined)).toEqual([]);
    const styles = buildCustomMapStyles('pk.test');
    expect(styles).toHaveLength(1);
    expect(styles[0].url).toBe('mapbox://styles/mapbox/satellite-streets-v12');
  });
});

describe('PestMapPage', () => {
  test('no WebGL -> explained, trap data still listed', async () => {
    vi.stubGlobal('fetch', vi.fn((url) => (String(url).includes('/api/map-data') ? json({ rows: ROWS, meta: META }) : json({}))));
    render(<PestMapPage />); // jsdom has no WebGL
    expect(await screen.findByText('This browser can’t display the map')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('SIM · Malur tomato')).toBeTruthy();
  });

  test('basemap unreachable -> clear message, simulated badge, trap data still listed', async () => {
    // Pretend WebGL works so the page gets as far as probing the basemap
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((kind) => (kind?.startsWith('webgl') ? {} : null));
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url) === DEFAULT_STYLE_URL) return Promise.reject(new TypeError('Failed to fetch'));
        if (String(url).includes('/api/map-data')) return json({ rows: ROWS, meta: META });
        return json({});
      })
    );
    render(<PestMapPage />);

    expect(await screen.findByText('The map can’t load right now')).toBeTruthy();
    expect(screen.getByText('Simulated data')).toBeTruthy();
    expect(screen.queryByTestId('kepler-container')).toBeNull();

    // Latest day is listed by default
    const table = screen.getByRole('table');
    expect(within(table).getByText('SIM · Malur tomato')).toBeTruthy();
    expect(within(table).getByText('BIOCONTROL')).toBeTruthy();

    // Earlier days stay reachable
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-10-17' } });
    expect(within(screen.getByRole('table')).getByText('SPRAY')).toBeTruthy();
    expect(within(screen.getByRole('table')).getByText('SIM · Kolar tomato')).toBeTruthy();
  });

  test('no observations -> instructions instead of an empty map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        String(url).includes('/api/map-data') ? json({ rows: [], meta: { ...META, simulated: false, row_count: 0 } }) : json({})
      )
    );
    render(<PestMapPage />);
    expect(await screen.findByText('No trap observations to map yet')).toBeTruthy();
    expect(screen.queryByText('Simulated data')).toBeNull();
  });

  test('API failure is reported, page does not crash', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    render(<PestMapPage />);
    expect(await screen.findByText(/Could not load map data/)).toBeTruthy();
  });
});
