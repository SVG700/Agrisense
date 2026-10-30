/**
 * Pure helpers that turn /api/map-data rows into a kepler.gl dataset + saved
 * map config. Kept free of kepler imports so they're cheap to unit-test.
 */

export const DATASET_ID = 'trap_observations';
export const MAP_ID = 'surveillance';
export const DEFAULT_STYLE_URL = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

/**
 * Extra basemaps. The default CARTO/MapLibre styles need no token; a satellite
 * style is added only when a Mapbox token is configured (VITE_MAPBOX_TOKEN).
 * Mapbox tokens used in browsers are public by design: use a URL-restricted one.
 */
export function buildCustomMapStyles(mapboxToken) {
  const token = (mapboxToken ?? '').trim();
  if (!token) return [];
  return [
    {
      id: 'mapbox_satellite',
      label: 'Satellite (Mapbox)',
      url: 'mapbox://styles/mapbox/satellite-streets-v12',
      icon: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/77.9,13.1,7,0/80x80?access_token=${encodeURIComponent(token)}`,
    },
  ];
}

/** Decision colours (shared with the trap table). */
export const DECISION_COLORS = {
  SPRAY: '#ef4444',
  BIOCONTROL: '#f59e0b',
  WAIT: '#22c55e',
};

const FIELDS = [
  'trap_id',
  'trap_name',
  'latitude',
  'longitude',
  'date',
  'pest_count',
  'predator_count',
  'decision',
  'dominant_pest',
  'simulated',
];

const DAY_MS = 86_400_000;

/**
 * kepler re-analyses column types when field types are omitted. `date` is sent
 * as "YYYY-MM-DD 12:00:00" so it is detected as a timestamp (a bare date is
 * typed as `date`, which the time-range filter can't use).
 *
 * Noon, not midnight: each daily row then sits in the middle of its one-day
 * filter window instead of on a window edge. kepler parses this string as UTC,
 * so the day windows below are computed in UTC too.
 */
export const ROW_TIME = '12:00:00';
export function toKeplerDataset(rows) {
  return {
    info: { id: DATASET_ID, label: 'Trap observations (per trap per day)' },
    data: {
      fields: FIELDS.map((name) => ({ name })),
      rows: rows.map((r) => [
        r.trap_id,
        r.trap_name,
        r.latitude,
        r.longitude,
        `${r.date} ${ROW_TIME}`,
        r.pest_count,
        r.predator_count,
        r.decision,
        r.dominant_pest ?? '',
        Boolean(r.simulated),
      ]),
    },
  };
}

/**
 * Timestamps (ms) of the first and last daily rows, i.e. noon UTC (kepler reads
 * row times as UTC). The filter window starts exactly here: kepler clamps any
 * earlier start to the first row, which would leave a window narrower than a day.
 */
export function dateDomain(rows) {
  const days = rows.map((r) => Date.parse(`${r.date}T${ROW_TIME}Z`)).filter(Number.isFinite);
  if (!days.length) return null;
  return [Math.min(...days), Math.max(...days)];
}

/**
 * Default view: points coloured by decision, sized by pest_count, and a
 * one-day time window on `date` that can be played to replay the outbreak.
 */
export function buildMapConfig(rows, { styleType = 'dark-matter' } = {}) {
  const domain = dateDomain(rows);
  // Kepler orders ordinal categories alphabetically; colorMap pins each value anyway.
  const ordered = ['BIOCONTROL', 'SPRAY', 'WAIT'];
  const filters = domain
    ? [
        {
          id: 'date_window',
          dataId: [DATASET_ID],
          name: ['date'],
          type: 'timeRange',
          // exactly 24 h wide: wherever it slides during playback it always contains one day's rows
          value: [domain[0], domain[0] + DAY_MS - 1],
          enlarged: true,
          plotType: { type: 'histogram' },
          animationWindow: 'free',
          speed: 0.5,
        },
      ]
    : [];

  return {
    version: 'v1',
    config: {
      visState: {
        filters,
        layers: [
          {
            id: 'decision_points',
            type: 'point',
            config: {
              dataId: DATASET_ID,
              label: 'Trap decision',
              columns: { lat: 'latitude', lng: 'longitude', altitude: null },
              isVisible: true,
              color: [34, 197, 94],
              visConfig: {
                // kepler scales these down at regional zoom; 30-120 reads as ~8-30 px around zoom 9
                radius: 40,
                fixedRadius: false,
                opacity: 0.85,
                outline: true,
                thickness: 1.5,
                strokeColor: [15, 23, 42],
                filled: true,
                radiusRange: [30, 120],
                colorRange: {
                  name: 'Spray / Biocontrol / Wait',
                  type: 'custom',
                  category: 'Custom',
                  colors: ordered.map((d) => DECISION_COLORS[d]),
                  colorMap: ordered.map((d) => [d, DECISION_COLORS[d]]),
                },
              },
            },
            visualChannels: {
              colorField: { name: 'decision', type: 'string' },
              colorScale: 'ordinal',
              sizeField: { name: 'pest_count', type: 'integer' },
              sizeScale: 'sqrt',
            },
          },
        ],
        interactionConfig: {
          tooltip: {
            enabled: true,
            fieldsToShow: {
              [DATASET_ID]: [
                { name: 'trap_name', format: null },
                { name: 'date', format: null },
                { name: 'decision', format: null },
                { name: 'pest_count', format: null },
                { name: 'predator_count', format: null },
                { name: 'dominant_pest', format: null },
                { name: 'simulated', format: null },
              ],
            },
          },
        },
      },
      mapStyle: { styleType },
    },
  };
}
